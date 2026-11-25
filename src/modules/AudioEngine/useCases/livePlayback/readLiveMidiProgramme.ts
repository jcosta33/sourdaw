/**
 * The live MIDI programme, read off project truth (#3892).
 *
 * `projectLiveMidiProgramme` is pure and takes its clock, its notes and its
 * projectors as values; this is the one place that binds them to the stores —
 * the same split `readLiveGraphProgramme` makes, and the same reason: the
 * projection is what a spec drives, and the binding is what a session runs.
 *
 * The projectors are the composition root's (`bootstrap.ts`), which is what
 * keeps the engine's take, the browser's and the bounce on one groove, one
 * chord track and one tempo map. An unconfigured projector answers no notes
 * rather than a guessed placement, exactly as the audio programme refuses.
 */

import { takeLaneStore, type Track } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { DEFAULT_TEMPO_BPM, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { offlineMidiEventProjectorState } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

import { bakedStripIds } from './bakedStripIds';
import { carriedEngineHostedStripIds } from './carriedEngineHostedStripIds';
import { liveTempoTimeline } from './liveTempoTimeline';
import { projectLiveMidiProgramme, type LiveMidiProgramme, type LiveMidiSpan } from './projectLiveMidiProgramme';

export type ReadLiveMidiProgrammeInput = Readonly<{
    /** The strips this session built, in project order. */
    stripTracks: readonly Track[];
    /**
     * The instances the native engine currently owns, from {@link readAttachedEngineInstanceIds}.
     *
     * The caller's, not read here, for the same reason `readLiveGraphProgramme`
     * takes it: one arm threads a single attach state through every projection
     * it makes, so the notes and the strips they are sent to cannot disagree
     * about which instruments the engine holds.
     */
    attachedInstanceIds: ReadonlySet<string>;
    /** The strips the topology batch built with `contributesAudio: true`. */
    carriedStripIds: ReadonlySet<string>;
    /** The frame grid this session's notes are placed on. */
    sampleRate: number;
    span: LiveMidiSpan;
}>;

/**
 * The programme, plus the seed every `schedule-midi` has to state.
 *
 * Carried beside the notes rather than inside them: the seed is a property of
 * the project, and this producer has already spent it deciding which notes it
 * emits at all.
 */
export type LiveMidiProgrammeRead = LiveMidiProgramme & Readonly<{ probabilitySeed: number }>;

/**
 * Move every note of a target by its strip's compensation, once, here.
 *
 * Not in the projection: the export calls that projection too and adds its own
 * shift (`projectNativeOfflineMidiCommands`), so a shift inside it would move
 * an exported note twice. The figure is read as the audio programme reads its
 * clips' (`readLiveGraphProgramme`), so a strip's notes and clips keep the
 * offset they have in the mix.
 *
 * The span the projection admits against is moved by the same figure
 * (`spanForStrip`), so a note is admitted by where it sounds. That is the
 * audio programme's law too: the engine loops the timeline, so a clip shifted
 * past the loop end is not reached that pass and one shifted into the loop
 * from before its start is.
 */
function compensateTargets(
    targets: LiveMidiProgramme['targets'],
    compensationDelaySeconds: (stripId: string) => number
): LiveMidiProgramme['targets'] {
    return targets.map((entry) => {
        const delay = compensationDelaySeconds(entry.target.trackId);
        if (delay === 0) {
            return entry;
        }
        return { ...entry, events: entry.events.map((event) => ({ ...event, time: event.time + delay })) };
    });
}

const EMPTY_PROGRAMME: LiveMidiProgramme = {
    targets: [],
    exclusions: [],
    nativeVoicedStripIds: new Set(),
};

export function readLiveMidiProgramme(input: ReadLiveMidiProgrammeInput): LiveMidiProgrammeRead {
    const midi = midiStore.value;
    const probabilitySeed = midi?.probabilitySeed ?? 0;
    const { project } = offlinePpqEndpointProjectorState;
    const { createProjector, createChordPitchProjector, selectProbability, resolveArticulationId } =
        offlineMidiEventProjectorState;
    if (!midi || !project || !createProjector || !selectProbability) {
        return { ...EMPTY_PROGRAMME, probabilitySeed };
    }
    const hostedStripIds = carriedEngineHostedStripIds(input.carriedStripIds, input.stripTracks);
    function compensationDelaySeconds(stripId: string): number {
        return getCompensationDelay(stripId, undefined, hostedStripIds);
    }
    const projected = projectLiveMidiProgramme({
        stripTracks: input.stripTracks,
        attachedInstanceIds: input.attachedInstanceIds,
        carriedStripIds: input.carriedStripIds,
        bakedStripIds: bakedStripIds({
            stripTracks: input.stripTracks,
            readBuffer: (bufferId) => audioBufferCache.get(bufferId),
        }),
        notesByClipId: midi.notesByClipId,
        takeLanes: takeLaneStore.value,
        tempoTimeline: liveTempoTimeline,
        probabilitySeed,
        defaultTempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM,
        sampleRate: input.sampleRate,
        changes: tempoMapStore.value?.changes ?? [],
        projectPpqEndpoints: project,
        projectMidiEvents: createProjector(),
        selectProbability,
        projectChordPitch: createChordPitchProjector?.() ?? null,
        resolveArticulationId,
        span: input.span,
        spanForStrip: (stripId) => {
            const delay = compensationDelaySeconds(stripId);
            return { startSeconds: input.span.startSeconds - delay, endSeconds: input.span.endSeconds - delay };
        },
    });
    return {
        ...projected,
        targets: compensateTargets(projected.targets, compensationDelaySeconds),
        probabilitySeed,
    };
}
