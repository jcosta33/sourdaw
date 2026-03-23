import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

export function setViewport(panX: number, panY: number, zoom: number): void {
    const state = nodeViewStore.value;
    if (!state) { return; }
    nodeViewStore.set({ ...state, panX, panY, zoom: Math.max(0.25, Math.min(4, zoom)) });
}
