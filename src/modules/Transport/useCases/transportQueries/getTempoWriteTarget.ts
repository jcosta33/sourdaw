import { getGoverningTempoChange, getTempoAtBeat } from '../../models/TempoMap';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';

/**
 * What a transport tempo edit reads and writes.
 *
 * `writable: false` means the playhead sits strictly inside a `linear` ramp,
 * where the tempo in force is interpolated between two events and is therefore
 * not any event's own value. Writing a typed BPM to the ramp's start point does
 * not make the playhead report that BPM — it moves the readout somewhere else
 * again — so the write must be refused rather than land where nobody asked for
 * it. That case always has a ramp event to name, which the union makes explicit
 * so the refusal can report *which* event it declined to write.
 */
export type TempoWriteTarget =
    | {
          /** The tempo currently in force at the target. */
          tempo: number;
          /**
           * The tempo-map change a write must rewrite, or `null` when there is no
           * map and the transport's base tempo is still the governing value.
           */
          tempoChangeId: string | null;
          writable: true;
      }
    | {
          /** The interpolated tempo in force — no event carries it. */
          tempo: number;
          /** The `linear` event the segment starts at. */
          tempoChangeId: string;
          writable: false;
      };

export type GetTempoWriteTargetInput = {
    /**
     * Resolve this named tempo-map change instead of resolving from the playhead.
     * `null` pins replay to the transport's base tempo. Undo and redo pass the
     * resolved target so a position-dependent write stays pinned.
     */
    tempoChangeId?: string | null;
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
 * Returns `null` when nothing can be resolved at all: no transport state, or a
 * named change that is no longer in the map. Both mean the destination is not
 * there, so an undo entry may legitimately carry no inverse. A resolved but
 * `writable: false` target is a different thing — the destination exists and the
 * write is *refused* — and callers must surface that rather than treat it as
 * another nothing-happened.
 */
export function getTempoWriteTarget(input: GetTempoWriteTargetInput = {}): TempoWriteTarget | null {
    const changes = tempoMapStore.value?.changes ?? [];

    if (input.tempoChangeId === null) {
        const transport = transportStore.value;
        return transport ? { tempo: transport.tempo, tempoChangeId: null, writable: true } : null;
    }

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
