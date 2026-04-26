import { nodeViewStore } from '../../stores/nodeView';

/** Removes a node and all its connected edges. */
export function removeNode(id: string): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.filter((node) => node.id !== id),
        connections: state.connections.filter((context) => context.fromNodeId !== id && context.toNodeId !== id),
    });
}
