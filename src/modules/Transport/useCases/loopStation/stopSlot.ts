import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const stopSlot = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function stopSlot(slotId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            slots: state.slots.map((s) => (s.id === slotId ? { ...s, state: 'stopped' as const } : s)),
        });
    };
});
