import { nodeViewStore } from '../../stores/nodeView';

export function moveNode(id: string, x: number, y: number): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)),
    });
}
