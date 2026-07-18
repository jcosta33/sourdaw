import { nodeViewStore } from '../../stores/nodeView';

export function toggleBypass(nodeIdVal: string): void {
    const state = nodeViewStore.value;
    if (!state) {
        return;
    }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.map((node) => (node.id === nodeIdVal ? { ...node, bypassed: !node.bypassed } : node)),
    });
}
