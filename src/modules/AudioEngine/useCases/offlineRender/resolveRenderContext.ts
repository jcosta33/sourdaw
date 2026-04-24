import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { tempoMapStore, transportStore, type TempoMapStoreState, type TransportState } from '#/modules/Transport/stores';

import { beatToSeconds } from '../../services/beatConversion';

export type OfflineRenderContext = {
    tracks: TrackStoreState | null;
    midi: MidiStoreState | null;
    transport: TransportState | null;
    defaultTempo: number;
    changes: TempoMapStoreState['changes'];
    durationSeconds: number;
};

/**
 * Gather all store snapshots the offline render needs. Consolidated here so
 * renderOffline and exportStems each only import this one helper instead of
 * reaching into several module stores directly.
 */
export function resolveRenderContext(durationBeats: number): OfflineRenderContext {
    const transport = transportStore.value;
    const tracks = trackStore.value;
    const midi = midiStore.value;
    const tempoMap = tempoMapStore.value;
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);

    return { tracks, midi, transport, defaultTempo, changes, durationSeconds };
}
