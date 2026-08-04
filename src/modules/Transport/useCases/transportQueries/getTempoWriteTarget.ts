import { getGoverningTempoChange, getTempoAtBeat } from '../../models/TempoMap';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';

export type TempoWriteTarget = {
    /** The tempo currently in force at the target. */
    tempo: number;
    /**
     * The tempo-map change a write must rewrite, or `null` when there is no map
     * and the transport's base tempo is still the governing value.
     */
    tempoChangeId: string | null;
    /**
     * False on a `linear` ramp segment, where the tempo in force is interpolated
     * between two events and is therefore not any event's own value. Writing a
     * typed BPM to the ramp's start point does not make the playhead report that
     * BPM — it moves the readout somewhere else again — so the write must be
     * refused rather than land where nobody asked for it.
     */
    writable: boolean;
};

export type GetTempoWriteTargetInput = {
    /**
     * Resolve this named tempo-map change instead of resolving from the playhead.
     * Undo and redo replay pass it so a position-dependent write stays pinned to
     * the event it originally landed on.
     */
    tempoChangeId?: string;
};

/**
 * Resolve what a transport tempo edit reads and writes.
 *
 * Without a named change the playhead decides, and the playhead is taken from
 * `playheadPositionRef` while playing and from the transport store otherwise.
 * The store's `playheadPosition` is written only on discrete transport events
 * (start, pause, stop, seek) — the scheduler advances the ref alone — so during
 * playback the store still holds the beat playback *began* at. Resolving against
 * it would rewrite the tempo event governing the play-start position instead of
 * the one governing what is being heard.
 *
 * Returns `null` when nothing can be resolved: no transport state, or a named
 * change that is no longer in the map. That is the only case in which a write
 * cannot land, and therefore the only case in which an undo entry may carry no
 * inverse.
 */
export function getTempoWriteTarget(input: GetTempoWriteTargetInput = {}): TempoWriteTarget | null {
    const changes = tempoMapStore.value?.changes ?? [];

    if (input.tempoChangeId !== undefined) {
        const named = changes.find((change) => change.id === input.tempoChangeId);
        if (!named) {
            return null;
        }
        return { tempo: named.tempo, tempoChangeId: named.id, writable: true };
    }

    const transport = transportStore.value;
    if (!transport) {
        return null;
    }

    const beat = transport.isPlaying ? playheadPositionRef.current : transport.playheadPosition;
    const governing = getGoverningTempoChange(changes, beat);
    if (!governing) {
        return { tempo: transport.tempo, tempoChangeId: null, writable: true };
    }
    if (governing.interpolated) {
        return {
            tempo: getTempoAtBeat(changes, beat, transport.tempo),
            tempoChangeId: governing.change.id,
            writable: false,
        };
    }
    return { tempo: governing.change.tempo, tempoChangeId: governing.change.id, writable: true };
}
