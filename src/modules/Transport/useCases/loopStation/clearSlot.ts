import { pushUndoEntry } from '#/modules/Command/stores';

import { loopStationStore } from '../../stores/loopStationStore';

export function clearSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    const targetSlot = state.slots.find((s) => s.id === slotId);
    if (!targetSlot) {
        return;
    }

    const previousSlots = state.slots;
    const nextSlots = state.slots.map((s) =>
        s.id === slotId ? { ...s, state: 'empty' as const, layers: [], lengthBeats: 0, loopCount: 0 } : s
    );
    loopStationStore.set({ ...state, slots: nextSlots });

    pushUndoEntry(
        'Clear loop slot',
        () => {
            const current = loopStationStore.value;
            if (!current) {
                return;
            }
            loopStationStore.set({ ...current, slots: previousSlots });
        },
        () => {
            const current = loopStationStore.value;
            if (!current) {
                return;
            }
            loopStationStore.set({ ...current, slots: nextSlots });
        }
    );
}
