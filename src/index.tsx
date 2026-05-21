/*
 * Copyright (c) 2025, WSO2 LLC. (http://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useState } from "react";
import { render } from "react-dom";
import { CellDiagram } from "./Diagram";
import { CellBounds } from "./components/Cell/CellNode/CellModel";
import { Component, ComponentType, Connection, ConnectionType, Organization, Project } from "./types";

export { CellDiagram } from "./Diagram";
export * from "./types";

// ── LLM-friendly spec ────────────────────────────────────────────────────────
// The shape callers (e.g. an agent) author. Field names mirror OpenChoreo concepts
// so a model that has read the CRDs maps straight onto them. Deliberately flat:
//   type      — OpenChoreo built-in ComponentType; drives the node icon. Default "service".
//   expose    — broadest gateway the component is reachable from (OpenChoreo endpoint
//               `visibility`). Omit ⇒ project-only, in-cell. "external" = public internet
//               (north); "internal"/"namespace" = within the org (west).
//   calls     — components this one calls. "name" = same project; "project/name" =
//               another project (becomes a cross-cell link).
//   resources — platform-managed dependencies (OpenChoreo Resource: DB/cache/queue).
//               On-platform south egress.
//   external  — third-party systems (Stripe, SendGrid…). Off-platform south egress.
export type CellComponentKind = "service" | "web-application" | "worker" | "scheduled-task";
export type CellExposure = "namespace" | "internal" | "external";

// OpenChoreo built-in ComponentType -> cell-diagram library ComponentType (icon).
// The library has no "worker"; EVENT_HANDLER is the closest async/background semantic.
const COMPONENT_TYPE_ICON: Record<CellComponentKind, ComponentType> = {
    "service": ComponentType.SERVICE,
    "web-application": ComponentType.WEB_APP,
    "worker": ComponentType.EVENT_HANDLER,
    "scheduled-task": ComponentType.SCHEDULED_TASK,
};

export interface CellComponentSpec {
    name: string;
    type?: CellComponentKind;
    expose?: CellExposure;
    calls?: string[];
    resources?: string[];
    external?: string[];
}
export interface CellProjectSpec {
    name: string;
    components: CellComponentSpec[];
}
export interface CellSpec {
    namespace?: string;
    projects: CellProjectSpec[];
}

// Translate the flat spec into the library's native model. Internal ids are
// index-based so names never collide between projects; the author only uses names.
// Returns a single Project when there's one (renders its expanded cell), otherwise an
// Organization (renders the collapsed org view with drill-down).
export function specToModel(spec: CellSpec): Organization | Project {
    const orgId = "org";
    const projectsIn = spec.projects || [];

    // shared-node key for resources / external systems (dedup within a project by name)
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    // "project/component" -> internal ids
    const resolver = new Map<string, { libId: string; projId: string }>();
    projectsIn.forEach((p, pi) =>
        (p.components || []).forEach((c, ci) => resolver.set(`${p.name}/${c.name}`, { libId: `c${pi}_${ci}`, projId: `p${pi}` }))
    );

    // Reverse map for the hover card: target "project/component" -> source "project/component"[]
    // (who calls each component, in-project and cross-project).
    const callers: Record<string, string[]> = {};
    projectsIn.forEach((p) =>
        (p.components || []).forEach((c) =>
            (c.calls || []).forEach((call) => {
                const targetKey = call.includes("/") ? call : `${p.name}/${call}`;
                (callers[targetKey] = callers[targetKey] || []).push(`${p.name}/${c.name}`);
            })
        )
    );

    const projects: Project[] = projectsIn.map((p, pi) => {
        const projId = `p${pi}`;
        const orgLinks: Record<string, true> = {};
        const components: Component[] = (p.components || []).map((c, ci) => {
            const libId = `c${pi}_${ci}`;
            const connections: Connection[] = [];

            (c.calls || []).forEach((call) => {
                const target = resolver.get(call.includes("/") ? call : `${p.name}/${call}`);
                if (!target) return;
                // `call` is already "project/component" for cross-project calls (same-project
                // calls have no slash), so the egress card shows which project each destination is in.
                connections.push({ id: `${orgId}:${target.projId}:${target.libId}`, type: ConnectionType.HTTP, label: call });
                if (target.projId !== projId) orgLinks[target.projId] = true; // inter-project link for the org view
            });
            // Platform-managed resources (on-platform) and third-party systems (off-platform).
            // The id is keyed by project + name (not per-component), so a resource used by
            // several components in the project renders as ONE shared node with N inbound links.
            (c.resources || []).forEach((res) => {
                connections.push({ id: `${orgId}:res:p${pi}:${slug(res)}`, type: ConnectionType.Datastore, onPlatform: true, label: res });
            });
            (c.external || []).forEach((ext) => {
                connections.push({ id: `${orgId}:ext:p${pi}:${slug(ext)}`, type: ConnectionType.Datastore, onPlatform: false, label: ext });
            });

            return {
                id: libId,
                label: c.name,
                version: "v1",
                type: COMPONENT_TYPE_ICON[c.type || "service"] || ComponentType.SERVICE,
                services: {
                    default: {
                        id: `${libId}_svc`,
                        type: "http",
                        dependencyIds: [],
                        deploymentMetadata: {
                            gateways: {
                                internet: { isExposed: c.expose === "external" },
                                intranet: { isExposed: c.expose === "internal" || c.expose === "namespace" },
                            },
                        },
                    },
                },
                connections,
                dependencies: {
                    out: [
                        ...(c.calls || []).map((call) => ({ label: call, kind: "calls" as const })),
                        ...(c.resources || []).map((res) => ({ label: res, kind: "uses" as const })),
                        ...(c.external || []).map((ext) => ({ label: ext, kind: "external" as const })),
                    ],
                    in: (callers[`${p.name}/${c.name}`] || []).map((src) => {
                        const [sp, sc] = src.split("/");
                        return sp === p.name ? sc : src; // strip prefix for same-project callers
                    }),
                },
            };
        });
        const connections = Object.keys(orgLinks).map((tp) => ({
            id: `to-${tp}`,
            source: { boundary: CellBounds.EastBound },
            target: { projectId: tp, boundary: CellBounds.WestBound },
        }));
        return { id: projId, name: p.name, components, connections };
    });

    if (projects.length === 1) return projects[0];
    return { id: orgId, name: spec.namespace || "namespace", projects, modelVersion: "0.4.0" };
}

// ── Rendering ─────────────────────────────────────────────────────────────────
// Org view (collapsed project cells + inter-project links) with double-click drill-in
// to a project's expanded cell, and a Back control. A single Project renders directly.
// Stock CellDiagram for both views; this just holds the org⇄project state.
function OrgApp({ organization }: { organization: Organization }) {
    const [projectId, setProjectId] = useState<string | null>(null);
    const project = projectId ? organization.projects.find((p) => p.id === projectId) : undefined;

    return (
        <div style={{ position: "absolute", inset: 0 }}>
            {project ? (
                <>
                    <div
                        style={{
                            position: "absolute",
                            top: 16,
                            left: 16,
                            zIndex: 10,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 14px",
                            font: "14px/1 GilmerRegular, sans-serif",
                            border: "1px solid rgba(0,0,0,0.15)",
                            borderRadius: 8,
                            background: "#fff",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                        }}
                        aria-label="breadcrumb"
                    >
                        <button
                            onClick={() => setProjectId(null)}
                            style={{
                                all: "unset",
                                cursor: "pointer",
                                color: "rgba(0,0,0,0.6)",
                                font: "inherit",
                            }}
                            title="Back to all projects"
                        >
                            ← {organization.name}
                        </button>
                        <span style={{ color: "rgba(0,0,0,0.3)" }}>/</span>
                        <span style={{ fontWeight: 600 }} aria-current="page">
                            {project.name}
                        </span>
                    </div>
                    <CellDiagram project={project} />
                </>
            ) : (
                <>
                    <div
                        style={{
                            position: "absolute",
                            top: 16,
                            left: 16,
                            zIndex: 10,
                            padding: "8px 14px",
                            font: "14px/1 GilmerRegular, sans-serif",
                            fontWeight: 600,
                            border: "1px solid rgba(0,0,0,0.15)",
                            borderRadius: 8,
                            background: "#fff",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                        }}
                        aria-label="breadcrumb"
                    >
                        {organization.name}
                    </div>
                    <CellDiagram
                        organization={organization}
                        onComponentDoubleClick={(id) => {
                            if (organization.projects.some((p) => p.id === id)) setProjectId(id);
                        }}
                    />
                </>
            )}
        </div>
    );
}

// Render the library's native model (Organization → org view + drill-down; Project →
// one expanded cell). Most callers want renderCellDiagram instead.
export function renderDiagram(model: Organization | Project, target: HTMLDivElement) {
    const data = JSON.parse(JSON.stringify(model));
    if (data && Array.isArray(data.projects)) {
        render(<OrgApp organization={data as Organization} />, target);
    } else {
        render(<CellDiagram project={data as Project} />, target);
    }
}

// The recommended entry point: render straight from the flat CellSpec.
export function renderCellDiagram(spec: CellSpec, target: HTMLDivElement) {
    renderDiagram(specToModel(JSON.parse(JSON.stringify(spec))), target);
}
