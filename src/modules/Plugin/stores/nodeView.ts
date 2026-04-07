/**
 * Node view store — manages Fusion-style node graph routing state.
 *
 * Extracted from nodeViewUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';

export type ProcessingNodeType =
    | 'input'
    | 'output'
    | 'effect'
    | 'instrument'
    | 'mixer'
    | 'splitter'
    | 'merger'
    | 'send'
    | 'return'
    | 'sidechain';

export type ProcessingNode = {
    id: string;
    type: ProcessingNodeType;
    label: string;
    deviceId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    bypassed: boolean;
    color: string;
};

export type NodeConnection = {
    id: string;
    fromNodeId: string;
    fromOutput: number;
    toNodeId: string;
    toInput: number;
};

export type NodeViewState = {
    nodes: ProcessingNode[];
    connections: NodeConnection[];
    activeTrackId: string | null;
    panX: number;
    panY: number;
    zoom: number;
    visible: boolean;
};

export const nodeViewStore = createStore<NodeViewState>({
    initialData: {
        nodes: [],
        connections: [],
        activeTrackId: null,
        panX: 0,
        panY: 0,
        zoom: 1,
        visible: false,
    },
});

let nodeId = 1;
let connectionId = 1;

export function getNextNodeId(): string {
    return `node-${nodeId++}`;
}

export function getNextConnectionId(): string {
    return `conn-${connectionId++}`;
}

export const NODE_COLORS: Record<ProcessingNodeType, string> = {
    input: 'oklch(0.45 0.08 140)',
    output: 'oklch(0.45 0.08 280)',
    effect: 'oklch(0.45 0.08 200)',
    instrument: 'oklch(0.45 0.08 60)',
    mixer: 'oklch(0.45 0.08 330)',
    splitter: 'oklch(0.40 0.06 200)',
    merger: 'oklch(0.40 0.06 200)',
    send: 'oklch(0.42 0.07 100)',
    return: 'oklch(0.42 0.07 140)',
    sidechain: 'oklch(0.42 0.07 20)',
};
