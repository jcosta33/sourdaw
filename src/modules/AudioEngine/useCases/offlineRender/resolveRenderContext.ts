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
    type OfflineChordPitchProjector,
    type OfflineAutomationValueEvaluator,
    type OfflineMidiEventProjector,
    type OfflineMidiArticulationResolver,
    type OfflineMidiProbabilitySelector,
} from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
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
    selectMidiEventProbability: OfflineMidiProbabilitySelector | null;
    projectChordPitch: OfflineChordPitchProjector | null;
    projectPpqEndpoints: OfflinePpqEndpointProjector | null;
    /** Flat tempo at a beat — what a buffer-content offset converts through. */
    resolveTempoAtBeat: OfflineTempoAtBeatResolver | null;
    processYeastMidi: OfflineYeastMidiProcessor | null;
    evaluateAutomationValue: OfflineAutomationValueEvaluator | null;
    resolveArticulationId?: OfflineMidiArticulationResolver | null;
};

export type ResolveRenderContextInput = {
    durationBeats: number;
    startBeat?: number;
    tailSeconds?: number;
    sampleRate?: number;
};

export function resolveRenderContext(input: ResolveRenderContextInput | number): OfflineRenderContext {
    const normalized: Required<ResolveRenderContextInput> =
        typeof input === 'number'
            ? { durationBeats: input, startBeat: 0, tailSeconds: 0, sampleRate: 44_100 }
            : {
                  durationBeats: input.durationBeats,
                  startBeat: input.startBeat ?? 0,
                  tailSeconds: input.tailSeconds ?? 0,
                  sampleRate: input.sampleRate ?? 44_100,
              };

    const transport = transportStore.value;
    const tracks = trackStore.value;
    const midi = midiStore.value;
    const tempoMap = tempoMapStore.value;
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];

    const projectPpqEndpoints = offlinePpqEndpointProjectorState.project;
    const projection = projectPpqEndpoints?.({
        startPpq: normalized.startBeat,
        endPpq: normalized.startBeat + normalized.durationBeats,
        defaultTempo,
        sampleRate: normalized.sampleRate,
        changes,
    });
    const legacyDuration =
        beatToSeconds(normalized.startBeat + normalized.durationBeats, defaultTempo, changes) -
        beatToSeconds(normalized.startBeat, defaultTempo, changes);
    const durationSeconds =
        Math.max(0, projection?.durationSeconds ?? legacyDuration) + Math.max(0, normalized.tailSeconds);

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
        selectMidiEventProbability: offlineMidiEventProjectorState.selectProbability,
        projectChordPitch: offlineMidiEventProjectorState.createChordPitchProjector?.() ?? null,
        projectPpqEndpoints,
        resolveTempoAtBeat: offlinePpqEndpointProjectorState.resolveTempoAtBeat,
        processYeastMidi: offlineYeastMidiProcessorState.createProcessor?.() ?? null,
        evaluateAutomationValue: offlineMidiEventProjectorState.evaluateAutomationValue,
        resolveArticulationId: offlineMidiEventProjectorState.resolveArticulationId,
    };
}
