import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

export function toggleNodeView(): void {
    const state = nodeViewStore.value;
    if (!state) { return; }
    nodeViewStore.set({ ...state, visible: !state.visible });
}
