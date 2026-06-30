import { aiStore } from '../../stores/aiStore';

export function toggleAiPanel() {
    aiStore.update((current) => {
        const state = current ?? { tasks: [], isPanelOpen: false };
        return { ...state, isPanelOpen: !state.isPanelOpen };
    });
}
