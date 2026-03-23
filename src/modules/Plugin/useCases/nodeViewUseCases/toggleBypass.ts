import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

export function toggleBypass(nodeIdVal: string): void {
    const state = nodeViewStore.value;
    if (!state) { return; }
    nodeViewStore.set({
        ...state,
        nodes: state.nodes.map((n) => (n.id === nodeIdVal ? { ...n, bypassed: !n.bypassed } : n)),
    });
}
