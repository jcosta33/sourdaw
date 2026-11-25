import { midiStore } from '#/modules/MIDI/stores';

import { offlineMidiEventProjectorState } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { type NativeOfflineMidiSource } from './projectNativeOfflineMidiCommands';

/**
 * A track whose note sink is a loaded hosted instrument
 * (`nativeOfflineInstrumentSink`) sends its MIDI as `schedule-midi` against
 * that device, projected by the live producer (`projectLiveMidiProgramme`)
 * from the render's captured MIDI snapshot and projectors, over the whole
 * export on the render's own timeline (frame 0 is beat 0; a region export is
 * rendered from the top and cropped afterwards). The command rides the
 * programme batch, after the strips exist. A lane naming a device on its
 * strip that this law will not carry — including any hosted lane when the
 * capture carries no hosted law — declines the render
 * (`nativeRefusedDeviceLane`) rather than printing a file without it.
 */

type CapturedRender = ReturnType<typeof captureOfflineRenderInput>;

type NativeOfflineMidiProjection = {
    midi: { notesByClipId: NativeOfflineMidiSource['notesByClipId']; probabilitySeed: number } | null | undefined;
    projectMidiEvents: NativeOfflineMidiSource['projectMidiEvents'] | null | undefined;
    selectProbability: NativeOfflineMidiSource['selectProbability'] | null | undefined;
    projectChordPitch: NativeOfflineMidiSource['projectChordPitch'];
    resolveArticulationId: NativeOfflineMidiSource['resolveArticulationId'];
};

function liveMidiProjection(): NativeOfflineMidiProjection {
    return {
        midi: midiStore.value,
        projectMidiEvents: offlineMidiEventProjectorState.createProjector?.() ?? null,
        selectProbability: offlineMidiEventProjectorState.selectProbability,
        projectChordPitch: offlineMidiEventProjectorState.createChordPitchProjector?.() ?? null,
        resolveArticulationId: offlineMidiEventProjectorState.resolveArticulationId,
    };
}

function capturedMidiProjection(context: CapturedRender['renderContext']): NativeOfflineMidiProjection {
    return {
        midi: context.midi,
        projectMidiEvents: context.projectMidiEvents,
        selectProbability: context.selectMidiEventProbability,
        projectChordPitch: context.projectChordPitch ?? null,
        resolveArticulationId: context.resolveArticulationId ?? null,
    };
}

function readMidiProjection(captured: CapturedRender | undefined): NativeOfflineMidiProjection {
    const context = captured?.renderContext;
    if (context) {
        return capturedMidiProjection(context);
    }
    return liveMidiProjection();
}

/**
 * The notes' source for a hosted-instrument track: the render's captured
 * snapshot and projections when it has one, the live ones otherwise (the same
 * fallback the automation lanes take), or `null` when the composition root
 * configured no projection — the Web Audio render refuses that case too.
 */
export function readNativeOfflineMidiSource(
    captured: CapturedRender | undefined,
    musical: Pick<NativeOfflineMidiSource, 'sampleRate' | 'defaultTempo' | 'changes' | 'projectPpqEndpoints'>,
    tempoTimeline: NativeOfflineMidiSource['tempoTimeline']
): NativeOfflineMidiSource | null {
    const { midi, projectMidiEvents, selectProbability, projectChordPitch, resolveArticulationId } =
        readMidiProjection(captured);
    if (!midi || !projectMidiEvents || !selectProbability) {
        return null;
    }
    return {
        notesByClipId: midi.notesByClipId,
        // The captured lanes the audio path comps against; absent capture falls to the live lanes.
        takeLanes: captured?.scheduling.takeLanes,
        tempoTimeline,
        probabilitySeed: midi.probabilitySeed,
        defaultTempo: musical.defaultTempo,
        sampleRate: musical.sampleRate,
        changes: musical.changes,
        projectPpqEndpoints: musical.projectPpqEndpoints,
        projectMidiEvents,
        selectProbability,
        projectChordPitch,
        resolveArticulationId,
    };
}
