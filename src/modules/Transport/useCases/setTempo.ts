import { createInvalidTempoError } from '../errors/InvalidTempoError';
import { getGoverningTempoChange } from '../models/TempoMap';
import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { tempoMapStore } from '../stores/tempoMapStore';

/**
 * Set the tempo the transport tempo field reads out.
 *
 * With **no tempo map** this is the project's base tempo: a plain
 * `transportStore.tempo` write, exactly as before.
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
 * The 20–300 range is the transport field's own; tempo-map events accept
 * 20–999 (see `MIN_TEMPO_MAP_TEMPO`). Values outside 20–300 are rejected here
 * whether or not a map governs.
 */
export function setTempo(bpm: number): void {
    if (bpm < 20 || bpm > 300) {
        throw createInvalidTempoError(bpm);
    }

    const state = getTransportState();
    if (!state) {
        return;
    }

    const tempoMap = tempoMapStore.value;
    const governingChange = getGoverningTempoChange(tempoMap?.changes ?? [], state.playheadPosition);
    if (!tempoMap || !governingChange) {
        updateTransportState({ tempo: bpm });
        return;
    }

    tempoMapStore.set({
        changes: tempoMap.changes.map((change) => {
            if (change.id !== governingChange.id) {
                return change;
            }
            return { ...change, tempo: bpm };
        }),
    });
}
