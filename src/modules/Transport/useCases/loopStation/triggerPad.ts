import { getAllTracks } from '#/modules/Arrangement/useCases';

import { loopStationStore } from '../../stores/loopStationStore';

import { toggleRecord } from './toggleRecord';
import { triggerSlot } from './triggerSlot';

type TriggerPadInput = {
    /** Zero-indexed scene row (0..3 for the 4 bound rows). */
    row: number;
    /** Zero-indexed track column (0..7 for the 8 bound columns). */
    column: number;
    /** Shift-held press: start / re-record the slot instead of playing. */
    record: boolean;
};

/**
 * Resolve the Loop Station grid pad at (row, column) → (trackId, row) and
 * dispatch to the matching slot. Plain press triggers playback of the slot;
 * shift-press routes to `toggleRecord` on that slot. No-op when the column
 * exceeds the available track count or no slot exists at that coordinate.
 */
export function triggerPad({ row, column, record }: TriggerPadInput): void {
    const tracks = getAllTracks();
    const track = tracks[column];
    if (!track) {
        return;
    }
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    const slot = state.slots.find((s) => s.trackId === track.id && s.row === row);
    if (!slot) {
        return;
    }

    if (record) {
        toggleRecord(slot.id);
        return;
    }
    triggerSlot(slot.id);
}
