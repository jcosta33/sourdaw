import { aiStore, getAiSnapshot } from '../../stores/aiStore';

export function toggleAiPanel() {
    const snapshot = getAiSnapshot();
    aiStore.set({ ...snapshot, isPanelOpen: !snapshot.isPanelOpen });
}
