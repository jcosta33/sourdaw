import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import {
    DEFAULT_TEMPO_BPM,
    tempoMapStore,
    transportStore,
    type TempoMapStoreState,
    type TransportState,
} from '#/modules/Transport/stores';

import {
    offlineMidiEventProjectorState,
    type OfflineChordPitchProjector,
    type OfflineAutomationValueEvaluator,
    type OfflineClipControllerProjector,
    type OfflineMidiEventProjector,
    type OfflineMidiArticulationResolver,
    type OfflineMidiProbabilitySelector,
} from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

import { captureOfflineMusicalProjections } from './captureOfflineMusicalProjections';
import { type OfflineRenderProjectSource } from './OfflineRenderSource';

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
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    /** Flat tempo at a beat — what a buffer-content offset converts through. */
    resolveTempoAtBeat: OfflineTempoAtBeatResolver | null;
    processYeastMidi: OfflineYeastMidiProcessor | null;
    evaluateAutomationValue: OfflineAutomationValueEvaluator | null;
    resolveArticulationId?: OfflineMidiArticulationResolver | null;
    projectClipControllers?: OfflineClipControllerProjector | null;
};

export type ResolveRenderContextInput = {
    durationBeats: number;
    startBeat?: number;
    tailSeconds?: number;
    sampleRate?: number;
};

export function resolveRenderContext(
    input: ResolveRenderContextInput | number,
    source?: OfflineRenderProjectSource
): OfflineRenderContext {
    const normalized: Required<ResolveRenderContextInput> =
        typeof input === 'number'
            ? { durationBeats: input, startBeat: 0, tailSeconds: 0, sampleRate: 44_100 }
            : {
                  durationBeats: input.durationBeats,
                  startBeat: input.startBeat ?? 0,
                  tailSeconds: input.tailSeconds ?? 0,
                  sampleRate: input.sampleRate ?? 44_100,
              };

    const transport = source ? source.transport : transportStore.value;
    const tracks = source ? source.tracks : trackStore.value;
    const midi = source ? source.midi : midiStore.value;
    const tempoMap = source ? source.tempoMap : tempoMapStore.value;
    const defaultTempo = transport?.tempo ?? DEFAULT_TEMPO_BPM;
    const changes = tempoMap?.changes ?? [];

    // The composition root injects Transport's tempo-map integrator, the one
    // live playback walks (ramps included). A render context with no projector
    // fails here, loudly, rather than measuring the region with a second
    // integrator that would drift from live playback.
    const projectPpqEndpoints = offlinePpqEndpointProjectorState.project;
    if (!projectPpqEndpoints) {
        throw new Error('Offline musical projection is not configured');
    }
    const projection = projectPpqEndpoints({
        startPpq: normalized.startBeat,
        endPpq: normalized.startBeat + normalized.durationBeats,
        defaultTempo,
        sampleRate: normalized.sampleRate,
        changes,
    });
    const durationSeconds = Math.max(0, projection.durationSeconds) + Math.max(0, normalized.tailSeconds);

    return {
        tracks,
        midi,
        transport,
        defaultTempo,
        changes,
        startBeat: normalized.startBeat,
        durationSeconds,
        tailSeconds: Math.max(0, normalized.tailSeconds),
        selectMidiEventProbability: offlineMidiEventProjectorState.selectProbability,
        projectPpqEndpoints,
        resolveTempoAtBeat: offlinePpqEndpointProjectorState.resolveTempoAtBeat,
        ...captureOfflineMusicalProjections(tracks, source),
        resolveArticulationId: offlineMidiEventProjectorState.resolveArticulationId,
        projectClipControllers: offlineMidiEventProjectorState.projectClipControllers,
    };
}
