import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip } from '#/modules/Arrangement/stores';
import { createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { handleCopyMidiArticulations } from '../handleCopyMidiArticulations';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';

type CopyMidiArticulationsAction = Extract<AppAction, { type: 'copyMidiArticulations' }>;
type RestoreMidiClipNotesAction = Extract<AppAction, { type: 'restoreMidiClipNotes' }>;

const sourceClipId = 'source-clip';
const targetClipId = 'target-clip';
const trackId = 'track-midi';

function midiClip(id: string): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#7c3aed',
        locked: false,
        muted: false,
    };
}

function sourceNote(articulation = 'staccato'): MidiClipNoteSnapshot {
    return {
        id: 'source-note',
        pitch: 60,
        startBeat: 0,
        duration: 1,
        velocity: 96,
        articulation,
    };
}

function targetNote(articulation = 'legato'): MidiClipNoteSnapshot {
    return {
        id: 'target-note',
        pitch: 67,
        startBeat: 1,
        duration: 0.5,
        velocity: 72,
        probability: 88,
        pressure: 0.35,
        slide: 0.2,
        pitchBend: -128,
        pitchBendRangeSemitones: 12,
        channel: 3,
        articulation,
    };
}

function targetNoteAfterCopy(): MidiClipNoteSnapshot {
    return {
        ...targetNote(),
        articulation: 'staccato',
    };
}

function requireRestoreAction(action: AppAction | null | undefined): RestoreMidiClipNotesAction {
    if (action?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes action');
    }
    return action;
}

function requireCanReapplyAfterDivergence(): NonNullable<typeof handleRestoreMidiClipNotes.canReapplyAfterDivergence> {
    const canReapplyAfterDivergence = handleRestoreMidiClipNotes.canReapplyAfterDivergence;
    if (canReapplyAfterDivergence === undefined) {
        throw new Error('Expected restore replay guard');
    }
    return canReapplyAfterDivergence;
}

function requireValidate(): NonNullable<typeof handleRestoreMidiClipNotes.validate> {
    const validate = handleRestoreMidiClipNotes.validate;
    if (validate === undefined) {
        throw new Error('Expected restore validator');
    }
    return validate;
}

function arrangeCopyFixture(): CopyMidiArticulationsAction {
    const track = createTrack({
        id: trackId,
        initialAlternativeId: 'track-midi-alt',
        initialDeviceId: 'track-midi-synth',
        kind: 'midi',
        name: 'MIDI',
    });
    setTrackStoreState({
        tracks: [{ ...track, clips: [midiClip(sourceClipId), midiClip(targetClipId)] }],
        selectedTrackId: trackId,
        ghostClips: [],
    });
    setMidiStoreState({
        notesByClipId: {
            [sourceClipId]: [sourceNote()],
            [targetClipId]: [targetNote()],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
    return {
        type: 'copyMidiArticulations',
        payload: {
            trackId,
            sourceClipId,
            targetClipId,
            notePairs: [{ sourceNoteId: 'source-note', targetNoteId: 'target-note' }],
            expectedSourceNotes: [sourceNote()],
            expectedTargetNotes: [targetNote()],
            expectedTrackFrozen: false,
            expectedSourceClipLocked: false,
            expectedTargetClipLocked: false,
        },
    };
}

function registerArticulationHandlers(): void {
    registerHandlerMap({
        copyMidiArticulations: handleCopyMidiArticulations,
        restoreMidiClipNotes: handleRestoreMidiClipNotes,
    });
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
});

afterEach(() => {
    setTrackStoreState({ tracks: [], selectedTrackId: null, ghostClips: [] });
    setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    clearHandlerRegistry();
});

describe('handleRestoreMidiClipNotes', () => {
    it('admits copyMidiArticulations into an atomic compensated batch when the restore guard matches live state', async () => {
        const action = arrangeCopyFixture();
        registerArticulationHandlers();

        const result = await executeAppActionBatch([action], {
            groupId: 'batch-articulations',
            groupLabel: 'Copy MIDI articulations',
            requireCompensation: true,
            source: 'prompt',
        });

        expect(result.status).toBe('committed');
        expect(result.actions.map((executed) => executed.action.type)).toEqual(['copyMidiArticulations']);
        expect(handleRestoreMidiClipNotes.requiresAbortCompensation).toBe(false);
        expect(handleRestoreMidiClipNotes.batchRestriction).toBeUndefined();
        expect(handleRestoreMidiClipNotes.validate).toBeDefined();
        expect(handleRestoreMidiClipNotes.canReapplyAfterDivergence).toBeDefined();
        expect(midiStoreSnapshot(targetClipId)).toEqual([targetNoteAfterCopy()]);
    });

    it('uses the articulation replay guard as a live state predicate for inverse restore', () => {
        const action = arrangeCopyFixture();
        const inverse = requireRestoreAction(handleCopyMidiArticulations.describe(action).inverseAction);

        expect(handleCopyMidiArticulations.execute(action)).toEqual({ status: 'written' });
        expect(midiStoreSnapshot(targetClipId)).toEqual([targetNoteAfterCopy()]);

        const canReapplyAfterDivergence = requireCanReapplyAfterDivergence();
        const validate = requireValidate();
        expect(canReapplyAfterDivergence(inverse)).toBe(true);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(midiStoreSnapshot(targetClipId)).toEqual([targetNote()]);

        setMidiStoreState({
            notesByClipId: {
                [sourceClipId]: [sourceNote('accent')],
                [targetClipId]: [targetNoteAfterCopy()],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        expect(canReapplyAfterDivergence(inverse)).toBe(false);
        expect(validate(inverse, { actions: [inverse], actionIndex: 0 })).toBe(false);
    });
});

function midiStoreSnapshot(clipId: string): readonly MidiClipNoteSnapshot[] | undefined {
    const state = midiStore.getSnapshot();
    return state?.notesByClipId[clipId];
}
