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
    durationSeconds: number;
};

/**
 * Gather all store snapshots the offline render needs. Consolidated here so
 * renderOffline and exportStems each only import this one helper instead of
 * reaching into Transport directly — keeps the cross-module cycle count stable.
 */
export function resolveRenderContext(durationBeats: number): OfflineRenderContext {
    const transport = getTransportStoreValue();
    const tracks = getTrackStoreState();
    const midi = getMidiStoreState();
    const tempoMap = getTempoMapState();
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);

    return { tracks, midi, transport, defaultTempo, changes, durationSeconds };
}
