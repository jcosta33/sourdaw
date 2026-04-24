import { nodeViewStore, getNextConnectionId, type NodeConnection } from '../../stores/nodeView';

export function connectNodes(fromNodeId: string, fromOutput: number, toNodeId: string, toInput: number): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }

    // Prevent duplicate connections
    const exists = state.connections.some(
        (context) =>
            context.fromNodeId === fromNodeId &&
            context.fromOutput === fromOutput &&
            context.toNodeId === toNodeId &&
            context.toInput === toInput
    );
    if (exists) {
        return;
    }

    // Prevent self-connections
    if (fromNodeId === toNodeId) {
        return;
    }

    const conn: NodeConnection = {
        id: getNextConnectionId(),
        fromNodeId,
        fromOutput,
        toNodeId,
        toInput,
    };

    nodeViewStore.set({ ...state, connections: [...state.connections, conn] });
}
