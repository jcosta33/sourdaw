import { aiStore, getAiSnapshot } from '../../stores/aiStore';

export const toggleAiPanel = () => {
    const s = getAiSnapshot();
    aiStore.set({ ...s, isPanelOpen: !s.isPanelOpen });
};
