import { createInvalidTempoError } from '../errors/InvalidTempoError';
import { createTempoRampWriteError } from '../errors/TempoRampWriteError';
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
     * `null` pins replay to the transport's base tempo. Undo and redo carry the
     * resolved target so a position-dependent write cannot move later.
     */
    tempoChangeId?: string | null;
};

export type SetTempoOutput = {
    /**
     * `no-write` when there was nothing to write to — no transport state, or a
     * named change that no longer exists. Both are "the destination is gone",
     * which undo and redo replay hit legitimately, so they stay a status rather
     * than an error. The caller must not record an undo entry for a `no-write`.
     *
     * A *refused* write — the playhead inside a `linear` ramp — throws instead.
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
 * Two positions are *not* writable, and neither lands somewhere the user did not
 * ask for:
 *
 * - strictly inside a `linear` ramp segment, where the tempo in force is
 *   interpolated between two events and no single event's `tempo` can reproduce
 *   it. This *throws*: `executeAppAction` turns a `no-write` into a silent abort
 *   and returns normally, so an AI caller reported the action as dispatched
 *   having changed nothing. (The ramp event's own beat is not this case — the
 *   interpolation factor there is 0 and the write is exactly defined.)
 * - anything at all when there is no transport state to resolve against, which
 *   stays a `no-write`: nothing was refused, the destination simply is not there
 *   yet, and undo replay reaches it legitimately.
 *
 * Ranges follow the destination, not the control: a base-tempo write is capped
 * at 300 like `transportStore`'s validator, a tempo-map write at 999 like
 * `tempoMapStore`'s. Narrowing a stored 400 BPM change to 300 because the
 * transport field happens to stop there would destroy it.
 */
export function setTempo(input: SetTempoInput): SetTempoOutput {
    const target = getTempoWriteTarget({ tempoChangeId: input.tempoChangeId });
    if (!target) {
        return { status: 'no-write' };
    }
    if (!target.writable) {
        throw createTempoRampWriteError({ bpm: input.bpm, tempoChangeId: target.tempoChangeId });
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
