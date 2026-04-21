import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getMidiStoreState } from '#/modules/MIDI/useCases';
import { getTempoMapState, getTransportStoreValue, type TempoChange } from '#/modules/Transport/useCases';

import { beatToSeconds } from '../../services/beatConversion';

export type OfflineRenderContext = {
    tracks: ReturnType<typeof getTrackStoreState>;
    midi: ReturnType<typeof getMidiStoreState>;
    transport: ReturnType<typeof getTransportStoreValue>;
    defaultTempo: number;
    changes: TempoChange[];
    /** Starting beat of the rendered region. */
    startBeat: number;
    /** Total render duration in seconds — includes tail. */
    durationSeconds: number;
    /** Tail seconds appended after the musical region. */
    tailSeconds: number;
};

export type ResolveRenderContextInput = {
    durationBeats: number;
    startBeat?: number;
    tailSeconds?: number;
};

export function resolveRenderContext(input: ResolveRenderContextInput | number): OfflineRenderContext {
    const normalized: Required<ResolveRenderContextInput> =
        typeof input === 'number'
            ? { durationBeats: input, startBeat: 0, tailSeconds: 0 }
            : { durationBeats: input.durationBeats, startBeat: input.startBeat ?? 0, tailSeconds: input.tailSeconds ?? 0 };

    const transport = getTransportStoreValue();
    const tracks = getTrackStoreState();
    const midi = getMidiStoreState();
    const tempoMap = getTempoMapState();
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];

    const regionStartSec = beatToSeconds(normalized.startBeat, defaultTempo, changes);
    const regionEndSec = beatToSeconds(normalized.startBeat + normalized.durationBeats, defaultTempo, changes);
    const durationSeconds = Math.max(0, regionEndSec - regionStartSec) + Math.max(0, normalized.tailSeconds);

    return {
        tracks,
        midi,
        transport,
        defaultTempo,
        changes,
        startBeat: normalized.startBeat,
        durationSeconds,
        tailSeconds: Math.max(0, normalized.tailSeconds),
    };
}
