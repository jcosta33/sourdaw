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

import { type Track } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { offlineMidiEventProjectorState } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { audioBufferCache } from '../../stores/audioBufferCache';

import { bakedStripIds } from './bakedStripIds';
import { projectLiveMidiProgramme, type LiveMidiProgramme, type LiveMidiSpan } from './projectLiveMidiProgramme';
import { readAttachedExternalInstanceIds } from './readAttachedExternalInstanceIds';

export type ReadLiveMidiProgrammeInput = Readonly<{
    /** The strips this session built, in project order. */
    stripTracks: readonly Track[];
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

const EMPTY_PROGRAMME: LiveMidiProgramme = {
    targets: [],
    exclusions: [],
    nativeVoicedStripIds: new Set(),
};

export function readLiveMidiProgramme(input: ReadLiveMidiProgrammeInput): LiveMidiProgrammeRead {
    const midi = midiStore.value;
    const probabilitySeed = midi?.probabilitySeed ?? 0;
    const { project } = offlinePpqEndpointProjectorState;
    const { createProjector, createChordPitchProjector, selectProbability } = offlineMidiEventProjectorState;
    if (!midi || !project || !createProjector || !selectProbability) {
        return { ...EMPTY_PROGRAMME, probabilitySeed };
    }
    return {
        ...projectLiveMidiProgramme({
            stripTracks: input.stripTracks,
            attachedInstanceIds: readAttachedExternalInstanceIds(),
            bakedStripIds: bakedStripIds({
                stripTracks: input.stripTracks,
                readBuffer: (bufferId) => audioBufferCache.get(bufferId),
            }),
            notesByClipId: midi.notesByClipId,
            probabilitySeed,
            defaultTempo: transportStore.value?.tempo ?? 120,
            sampleRate: input.sampleRate,
            changes: tempoMapStore.value?.changes ?? [],
            projectPpqEndpoints: project,
            projectMidiEvents: createProjector(),
            selectProbability,
            projectChordPitch: createChordPitchProjector?.() ?? null,
            span: input.span,
        }),
        probabilitySeed,
    };
}
