import { nodeViewStore, getNextNodeId, getNextConnectionId, NODE_COLORS, type ProcessingNode, type NodeConnection } from '#/modules/Plugin/stores/nodeView';

/**
 * Build a node graph from a track's linear device chain.
 * Creates input → device₁ → device₂ → … → output graph.
 */
export function buildFromDeviceChain(trackId: string, devices: Array<{ id: string; name: string }>): void {
    const state = nodeViewStore.value;
    if (!state) { return; }

    const nodes: ProcessingNode[] = [];
    const connections: NodeConnection[] = [];

    // Input node
    const inputNode: ProcessingNode = {
        id: getNextNodeId(), type: 'input', label: 'Input', deviceId: null,
        x: 50, y: 200, width: 100, height: 50, bypassed: false, color: NODE_COLORS.input,
    };
    nodes.push(inputNode);

    // Device nodes
    let prevNodeId = inputNode.id;
    let xPos = 220;
    for (const device of devices) {
        const dNode: ProcessingNode = {
            id: getNextNodeId(), type: 'effect', label: device.name, deviceId: device.id,
            x: xPos, y: 200, width: 120, height: 60, bypassed: false, color: NODE_COLORS.effect,
        };
        nodes.push(dNode);
        connections.push({
            id: getNextConnectionId(), fromNodeId: prevNodeId, fromOutput: 0, toNodeId: dNode.id, toInput: 0,
        });
        prevNodeId = dNode.id;
        xPos += 170;
    }

    // Output node
    const outputNode: ProcessingNode = {
        id: getNextNodeId(), type: 'output', label: 'Output', deviceId: null,
        x: xPos, y: 200, width: 100, height: 50, bypassed: false, color: NODE_COLORS.output,
    };
    nodes.push(outputNode);
    connections.push({
        id: getNextConnectionId(), fromNodeId: prevNodeId, fromOutput: 0, toNodeId: outputNode.id, toInput: 0,
    });

    nodeViewStore.set({ ...state, nodes, connections, activeTrackId: trackId });
}
