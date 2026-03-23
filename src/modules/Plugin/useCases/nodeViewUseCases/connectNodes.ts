import { nodeViewStore, getNextConnectionId, type NodeConnection } from '#/modules/Plugin/stores/nodeView';

export function connectNodes(fromNodeId: string, fromOutput: number, toNodeId: string, toInput: number): void {
    const state = nodeViewStore.value;
    if (!state) { return; }

    // Prevent duplicate connections
    const exists = state.connections.some(
        (c) => c.fromNodeId === fromNodeId && c.fromOutput === fromOutput && c.toNodeId === toNodeId && c.toInput === toInput
    );
    if (exists) { return; }

    // Prevent self-connections
    if (fromNodeId === toNodeId) { return; }

    const conn: NodeConnection = {
        id: getNextConnectionId(),
        fromNodeId, fromOutput, toNodeId, toInput,
    };

    nodeViewStore.set({ ...state, connections: [...state.connections, conn] });
}
