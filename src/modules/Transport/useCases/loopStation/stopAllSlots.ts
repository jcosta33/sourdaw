import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const stopAllSlots = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function stopAllSlots(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            slots: state.slots.map((s) =>
                s.state === 'playing' || s.state === 'overdubbing' ? { ...s, state: 'stopped' as const } : s
            ),
        });
    };
});
