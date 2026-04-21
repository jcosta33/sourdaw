import { loopStationStore } from '../../stores/loopStationStore';

/**
 * Trigger playback for a single slot by id. If the slot has no recorded
 * content this is a no-op. Transient / transport-like; does not push undo.
 */
export function triggerSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    const slot = state.slots.find((s) => s.id === slotId);
    if (!slot || slot.layers.length === 0) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) => (s.id === slotId ? { ...s, state: 'playing' as const } : s)),
    });
}
