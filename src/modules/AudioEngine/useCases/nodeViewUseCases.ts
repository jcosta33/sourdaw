/**
 * Node-Based Processing View
 *
 * Optional Fusion-style routing view instead of linear inserts.
 * Represents the audio signal flow as a directed graph of
 * processing nodes that can be freely connected.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

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
    /** Display label */
    label: string;
    /** Device ID (for effect/instrument nodes) */
    deviceId: string | null;
    /** Position on the canvas */
    x: number;
    y: number;
    /** Node width/height for hit-testing */
    width: number;
    height: number;
    /** Is this node bypassed? */
    bypassed: boolean;
    /** Color for visual identification */
    color: string;
};

export type NodeConnection = {
    id: string;
    /** Source node ID */
    fromNodeId: string;
    /** Source output index (0 = main, 1+ = aux) */
    fromOutput: number;
    /** Destination node ID */
    toNodeId: string;
    /** Destination input index */
    toInput: number;
};

export type NodeViewState = {
    nodes: ProcessingNode[];
    connections: NodeConnection[];
    /** Which track's chain is being viewed */
    activeTrackId: string | null;
    /** Viewport pan offset */
    panX: number;
    panY: number;
    /** Viewport zoom */
    zoom: number;
    /** Is the node view visible? */
    visible: boolean;
};

export const nodeViewStore = new Store<NodeViewState>(logger, {
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

const NODE_COLORS: Record<ProcessingNodeType, string> = {
    input: 'oklch(0.65 0.12 140)',
    output: 'oklch(0.65 0.12 280)',
    effect: 'oklch(0.65 0.12 200)',
    instrument: 'oklch(0.65 0.12 60)',
    mixer: 'oklch(0.65 0.12 330)',
    splitter: 'oklch(0.55 0.08 200)',
    merger: 'oklch(0.55 0.08 200)',
    send: 'oklch(0.60 0.10 100)',
    return: 'oklch(0.60 0.10 140)',
    sidechain: 'oklch(0.60 0.10 20)',
};

export function toggleNodeView(): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({ ...state, visible: !state.visible });
}

export function addNode(type: ProcessingNodeType, label: string, x: number, y: number, deviceId: string | null = null): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }

    const node: ProcessingNode = {
        id: `node-${nodeId++}`,
        type, label, deviceId, x, y,
        width: 120, height: 60,
        bypassed: false,
        color: NODE_COLORS[type],
    };

    nodeViewStore.set({ ...state, nodes: [...state.nodes, node] });
}

export function removeNode(id: string): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.filter((n) => n.id !== id),
        connections: state.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id),
    });
}

export function moveNode(id: string, x: number, y: number): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    });
}

export function connectNodes(fromNodeId: string, fromOutput: number, toNodeId: string, toInput: number): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }

    // Prevent duplicate connections
    const exists = state.connections.some(
        (c) => c.fromNodeId === fromNodeId && c.fromOutput === fromOutput && c.toNodeId === toNodeId && c.toInput === toInput
    );
    if (exists) {
        return;
    }

    // Prevent self-connections
    if (fromNodeId === toNodeId) {
        return;
    }

    const conn: NodeConnection = {
        id: `conn-${connectionId++}`,
        fromNodeId, fromOutput, toNodeId, toInput,
    };

    nodeViewStore.set({ ...state, connections: [...state.connections, conn] });
}

export function disconnectNodes(connId: string): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        connections: state.connections.filter((c) => c.id !== connId),
    });
}

export function toggleBypass(nodeIdVal: string): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.map((n) => (n.id === nodeIdVal ? { ...n, bypassed: !n.bypassed } : n)),
    });
}

export function setViewport(panX: number, panY: number, zoom: number): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({ ...state, panX, panY, zoom: Math.max(0.25, Math.min(4, zoom)) });
}

/**
 * Build a node graph from a track's linear device chain.
 */
export function buildFromDeviceChain(trackId: string, devices: Array<{ id: string; name: string }>): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }

    const nodes: ProcessingNode[] = [];
    const connections: NodeConnection[] = [];

    // Input node
    const inputNode: ProcessingNode = {
        id: `node-${nodeId++}`, type: 'input', label: 'Input', deviceId: null,
        x: 50, y: 200, width: 100, height: 50, bypassed: false, color: NODE_COLORS.input,
    };
    nodes.push(inputNode);

    // Device nodes
    let prevNodeId = inputNode.id;
    let xPos = 220;
    for (const device of devices) {
        const dNode: ProcessingNode = {
            id: `node-${nodeId++}`, type: 'effect', label: device.name, deviceId: device.id,
            x: xPos, y: 200, width: 120, height: 60, bypassed: false, color: NODE_COLORS.effect,
        };
        nodes.push(dNode);
        connections.push({
            id: `conn-${connectionId++}`, fromNodeId: prevNodeId, fromOutput: 0, toNodeId: dNode.id, toInput: 0,
        });
        prevNodeId = dNode.id;
        xPos += 170;
    }

    // Output node
    const outputNode: ProcessingNode = {
        id: `node-${nodeId++}`, type: 'output', label: 'Output', deviceId: null,
        x: xPos, y: 200, width: 100, height: 50, bypassed: false, color: NODE_COLORS.output,
    };
    nodes.push(outputNode);
    connections.push({
        id: `conn-${connectionId++}`, fromNodeId: prevNodeId, fromOutput: 0, toNodeId: outputNode.id, toInput: 0,
    });

    nodeViewStore.set({ ...state, nodes, connections, activeTrackId: trackId });
}
