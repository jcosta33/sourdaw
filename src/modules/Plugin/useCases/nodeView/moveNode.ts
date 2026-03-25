import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

export function moveNode(id: string, x: number, y: number): void {
    const state = nodeViewStore.value;
    if (!state) { return; }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    });
}
