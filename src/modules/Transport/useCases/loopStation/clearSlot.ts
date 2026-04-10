import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const clearSlot = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function clearSlot(slotId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            slots: state.slots.map((s) =>
                s.id === slotId ? { ...s, state: 'empty' as const, layers: [], lengthBeats: 0, loopCount: 0 } : s
            ),
        });
    };
});
