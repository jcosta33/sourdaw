import { inject } from '#/infra/di/inject';
import { aiStore, getAiSnapshot } from '../../stores/aiStore';

export const toggleAiPanel = inject({ aiStore, getAiSnapshot })(
    ({ aiStore, getAiSnapshot }) =>
        function toggleAiPanel() {
            const snapshot = getAiSnapshot();
            aiStore.set({ ...snapshot, isPanelOpen: !snapshot.isPanelOpen });
        }
);
