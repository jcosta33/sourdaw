import { nodeViewStore } from '../../stores/nodeView';

export function disconnectNodes(connId: string): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        connections: state.connections.filter((context) => context.id !== connId),
    });
}
