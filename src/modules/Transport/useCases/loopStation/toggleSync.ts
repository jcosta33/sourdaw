import { pushUndoEntry } from '#/modules/Command/stores';

import { loopStationStore } from '../../stores/loopStationStore';

export function toggleSync(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    const previous = state.syncToTransport;
    const next = !previous;
    loopStationStore.set({ ...state, syncToTransport: next });

    pushUndoEntry(
        next ? 'Enable loop sync' : 'Disable loop sync',
        () => {
            const current = loopStationStore.value;
            if (!current) {
                return;
            }
            loopStationStore.set({ ...current, syncToTransport: previous });
        },
        () => {
            const current = loopStationStore.value;
            if (!current) {
                return;
            }
            loopStationStore.set({ ...current, syncToTransport: next });
        }
    );
}
