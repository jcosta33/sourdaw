import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

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
