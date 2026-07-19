import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import {
    tempoMapStore,
    transportStore,
    type TempoMapStoreState,
    type TransportState,
} from '#/modules/Transport/stores';

import {
    offlineMidiEventProjectorState,
    type OfflineMidiEventProjector,
} from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import {
    offlineYeastMidiProcessorState,
    type OfflineYeastMidiProcessor,
} from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';
import { beatToSeconds } from '../../services/beatConversion';

export type OfflineRenderContext = {
    tracks: TrackStoreState | null;
    midi: MidiStoreState | null;
    transport: TransportState | null;
    defaultTempo: number;
    changes: TempoMapStoreState['changes'];
    /** Starting beat of the rendered region. */
    startBeat: number;
    /** Total render duration in seconds — includes tail. */
    durationSeconds: number;
    /** Tail seconds appended after the musical region. */
    tailSeconds: number;
    projectMidiEvents: OfflineMidiEventProjector | null;
    processYeastMidi: OfflineYeastMidiProcessor | null;
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
            : {
                  durationBeats: input.durationBeats,
                  startBeat: input.startBeat ?? 0,
                  tailSeconds: input.tailSeconds ?? 0,
              };

    const transport = transportStore.value;
    const tracks = trackStore.value;
    const midi = midiStore.value;
    const tempoMap = tempoMapStore.value;
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
        projectMidiEvents: offlineMidiEventProjectorState.createProjector?.() ?? null,
        processYeastMidi: offlineYeastMidiProcessorState.createProcessor?.() ?? null,
    };
}
