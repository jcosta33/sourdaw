import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

/** Removes a node and all its connected edges. */
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
