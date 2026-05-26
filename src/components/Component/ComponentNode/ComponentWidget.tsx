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

import React, { useContext, useEffect, useRef, useState } from "react";
import { DiagramEngine, LinkModel, PortModel, PortModelAlignment } from "@projectstorm/react-diagrams";
import { ComponentModel } from "./ComponentModel";
import { ComponentLinkModel } from "../ComponentLink/ComponentLinkModel";
import { ComponentHeadWidget } from "./ComponentHead/ComponentHead";
import { ComponentName, ComponentNode, IngressBadge, PortsContainer } from "./styles";
import { DiagramContext } from "../../DiagramContext/DiagramContext";
import { ComponentPortWidget } from "../ComponentPort/ComponentPortWidget";
import { Tooltip } from "@mui/material";
import { ExternalConsumerLinkSelectEvent } from "../../../types";
import { CellBounds } from "../../Cell/CellNode/CellModel";


interface ComponentWidgetProps {
    node: ComponentModel;
    engine: DiagramEngine;
}

export function ComponentWidget(props: ComponentWidgetProps) {
    const { node, engine } = props;
    const { selectedNodeId, focusedNodeId, componentMenu, onComponentDoubleClick, previewMode } = useContext(DiagramContext);
    const [selectedLink, setSelectedLink] = useState<ComponentLinkModel>(undefined);
    const [isHovered, setIsHovered] = useState<boolean>(false);
    const headPorts = useRef<PortModel[]>([]);

    const displayName: string = node.component.label || node.component.id;
    const isDisabled = node.component.disabled?.status;

    useEffect(() => {
        if (previewMode) {
            return;
        }
        const listener = node.registerListener({
            SELECT: (event: any) => {
                setSelectedLink(event.component as ComponentLinkModel);
            },
            UNSELECT: () => {
                setSelectedLink(undefined);
            },
        });
        headPorts.current.push(node.getPortFromID(`left-${node.getID()}`));
        headPorts.current.push(node.getPortFromID(`right-${node.getID()}`));
        headPorts.current.push(node.getPortFromID(`bottom-${node.getID()}`));

        const handleExternalConsumerLink = (evt: ExternalConsumerLinkSelectEvent, action: 'SELECT' | 'UNSELECT') => {
            setIsHovered(action === 'SELECT');
            const portId = evt.cellBound === CellBounds.NorthBound ? 'top' : 'left';
            const alignment = evt.cellBound === CellBounds.NorthBound ? PortModelAlignment.TOP : PortModelAlignment.LEFT;
            const port = node.getPort(`${portId}-${node.getID()}`);
            const portLinks: Map<string, LinkModel> = new Map(Object.entries(port.links));
            portLinks.forEach((link) => {
                if (link.getTargetPort().getOptions().alignment === alignment) {
                    link.fireEvent({}, action);
                }
            });
        };

        const externalConsumerListener = node.registerListener({
            EXTERNAL_CONSUMER_LINK_SELECT: (evt: ExternalConsumerLinkSelectEvent) => {
                handleExternalConsumerLink(evt, 'SELECT');
            },
            EXTERNAL_CONSUMER_LINK_UNSELECT: (evt: ExternalConsumerLinkSelectEvent) => {
                handleExternalConsumerLink(evt, 'UNSELECT');
            },
        });

        return () => {
            node.deregisterListener(listener);
            node.deregisterListener(externalConsumerListener);
        };
    }, [node]);

    const handleOnHover = (task: string) => {
        setIsHovered(task === "SELECT" ? true : false);
        node.handleHover(headPorts.current, task);
    };

    const handleOnWidgetDoubleClick = () => {
        if (onComponentDoubleClick) {
            onComponentDoubleClick(node.component.id);
        }
    };

    const handleMouseEnter = () => {
        if (previewMode) {
            return;
        }
        setIsHovered(true);
        handleOnHover("SELECT");
    };

    const handleMouseLeave = () => {
        if (previewMode) {
            return;
        }
        setIsHovered(false);
        handleOnHover("UNSELECT");
    };

    const handleOnContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const deps = node.component.dependencies;
    const hasDeps = !previewMode && deps && (deps.out.length > 0 || deps.in.length > 0);
    // Cross-cell inbound: callers from a different project (the spec keeps the
    // "project/component" prefix only for those; same-project callers are bare names).
    const hasCrossCellInbound = !previewMode && !!deps?.in?.some((s) => s.includes("/"));
    const eyebrow: React.CSSProperties = { opacity: 0.55, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 5 };
    const depCard = (
        <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700 }}>{displayName}</div>
            {deps && deps.out.length > 0 && (
                <>
                    <div style={eyebrow}>depends on</div>
                    {deps.out.map((d, i) => (
                        <div key={`o${i}`}>{d.label}</div>
                    ))}
                </>
            )}
            {deps && deps.in.length > 0 && (
                <>
                    <div style={eyebrow}>used by</div>
                    {deps.in.map((s, i) => (
                        <div key={`i${i}`}>{s}</div>
                    ))}
                </>
            )}
        </div>
    );

    return (
        <ComponentNode
            previewMode={previewMode}
            onMouseOver={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onDoubleClick={handleOnWidgetDoubleClick}
            onContextMenu={handleOnContextMenu}
        >
            <Tooltip title={hasDeps ? depCard : ""} placement="right" arrow enterDelay={150} enterNextDelay={150}>
                <span style={{ position: "relative", display: "inline-block" }}>
                    <ComponentHeadWidget
                        engine={engine}
                        node={node}
                        isSelected={node.getID() === selectedNodeId || node.isNodeSelected(selectedLink, node.getID())}
                        isFocused={node.getID() === focusedNodeId || isHovered}
                        menuItems={componentMenu}
                        onFocusOut={handleMouseLeave}
                    />
                    {hasCrossCellInbound && <IngressBadge />}
                </span>
            </Tooltip>
            <Tooltip title={displayName} placement="bottom" enterNextDelay={500} arrow>
                {!previewMode ? <ComponentName disabled={isDisabled}>{displayName}</ComponentName> : <></>}
            </Tooltip>
            <PortsContainer>
                <ComponentPortWidget port={node.getPort(`top-${node.getID()}`)} engine={engine} />
                <ComponentPortWidget port={node.getPort(`bottom-${node.getID()}`)} engine={engine} />
            </PortsContainer>
        </ComponentNode>
    );
}
