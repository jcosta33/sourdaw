import { createInvalidTempoError } from '../errors/InvalidTempoError';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { MIN_TEMPO_MAP_TEMPO, MAX_TEMPO_MAP_TEMPO, tempoMapStore } from '../stores/tempoMapStore';

import { getTempoWriteTarget } from './transportQueries/getTempoWriteTarget';

/** Range of the transport's own base tempo, mirroring `transportStore`'s validator. */
const MIN_BASE_TEMPO = 20;
const MAX_BASE_TEMPO = 300;

export type SetTempoInput = {
    bpm: number;
    /**
     * Rewrite this tempo-map change instead of resolving one from the playhead.
     * Undo and redo replay carry it so a position-dependent write stays pinned to
     * the event it originally landed on.
     */
    tempoChangeId?: string;
};

export type SetTempoOutput = {
    /**
     * `no-write` when nothing changed — no transport state, a named change that
     * no longer exists, or a playhead sitting on a `linear` ramp segment where no
     * single event carries the tempo being reported. The caller must not record
     * an undo entry for a `no-write`.
     */
    status: 'written' | 'no-write';
};

/**
 * Set the tempo the transport tempo field reads out.
 *
 * With **no tempo map** this is the project's base tempo: a plain
 * `transportStore.tempo` write, exactly as it always was.
 *
 * With a **tempo map** `transportStore.tempo` is inert. Every scheduler path
 * resolves tempo through `beatToSamples(changes, beat, transport.tempo, sr)`,
 * and `getTempoAtBeat` consults `defaultTempo` only for an empty map — so with
 * any non-empty map (a change at beat 0 being the common case) writing
 * `transport.tempo` changed nothing anyone could hear.
 *
 * The field then follows the shipping-DAW convention: it reads the tempo
 * governing the playhead, and writing to it edits *that* tempo event. Cubase
 * documents this contract explicitly for its Tempo Track mode — the value
 * "change[s] the tempo at the cursor", landing at project start when the
 * project has no tempo changes yet
 * (archive.steinberg.help, Cubase "Project Tempo Modes"). Logic Pro and
 * Studio One likewise keep the field live and show the map's value at the
 * playhead. Pro Tools is the outlier: it makes the field read-only whenever
 * the Conductor is enabled. No DAW makes the field scale the map.
 *
 * Two positions are *not* writable, and both report `no-write` rather than
 * landing somewhere the user did not ask for:
 *
 * - a `linear` ramp segment, where the tempo in force is interpolated between
 *   two events and no single event's `tempo` can reproduce it;
 * - anything at all when there is no transport state to resolve against.
 *
 * Ranges follow the destination, not the control: a base-tempo write is capped
 * at 300 like `transportStore`'s validator, a tempo-map write at 999 like
 * `tempoMapStore`'s. Narrowing a stored 400 BPM change to 300 because the
 * transport field happens to stop there would destroy it.
 */
export function setTempo(input: SetTempoInput): SetTempoOutput {
    const target = getTempoWriteTarget({ tempoChangeId: input.tempoChangeId });
    if (!target || !target.writable) {
        return { status: 'no-write' };
    }

    if (target.tempoChangeId === null) {
        if (input.bpm < MIN_BASE_TEMPO || input.bpm > MAX_BASE_TEMPO) {
            throw createInvalidTempoError(input.bpm);
        }
        updateTransportState({ tempo: input.bpm });
        return { status: 'written' };
    }

    return writeTempoChange({ bpm: input.bpm, tempoChangeId: target.tempoChangeId });
}

type WriteTempoChangeInput = {
    bpm: number;
    tempoChangeId: string;
};

function writeTempoChange({ bpm, tempoChangeId }: WriteTempoChangeInput): SetTempoOutput {
    if (bpm < MIN_TEMPO_MAP_TEMPO || bpm > MAX_TEMPO_MAP_TEMPO) {
        throw createInvalidTempoError(bpm);
    }

    const tempoMap = tempoMapStore.value;
    if (!tempoMap) {
        return { status: 'no-write' };
    }
    if (!tempoMap.changes.some((change) => change.id === tempoChangeId)) {
        // The named change was removed since the write this inverts. Restoring a
        // tempo onto some other event would be worse than doing nothing.
        return { status: 'no-write' };
    }

    tempoMapStore.set({
        changes: tempoMap.changes.map((change) => {
            if (change.id !== tempoChangeId) {
                return change;
            }
            return { ...change, tempo: bpm };
        }),
    });
    return { status: 'written' };
}
