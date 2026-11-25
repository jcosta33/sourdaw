import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';

import { midiStore } from '../../../stores/midiStore';
import { stepRecordStore } from '../../../stores/stepRecordStore';
import { stepRecordNoteOn } from '../stepRecordNoteOn';
import { toggleStepRecording } from '../toggleStepRecording';
import { toggleStepRecordingForClip } from '../toggleStepRecordingForClip';

import { makeStepRecordState, resetStepRecordNavigationStores } from './stepRecordNavigationTestHelpers';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    trackState: { tracks: [] as Array<{ id: string; frozen: boolean; clips: Array<{ id: string }> }> },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
    clipSelectionStore: { value: { selectedClipId: 'clip-a' } },
}));
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { playheadPosition: 2 } },
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const FROZEN_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';

const setClipTrackFrozen = (frozen: boolean): void => {
    mocks.trackState.tracks = [{ id: 'track-1', frozen, clips: [{ id: 'clip-a' }] }];
};

const frozenWarnings = (): unknown[][] =>
    mocks.notifyUser.mock.calls.filter((call) => call[0] === FROZEN_MESSAGE && call[1] === 'warning');

describe('step recording on a frozen track', () => {
    beforeEach(() => {
        clearUndoHistory();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        mocks.notifyUser.mockClear();
    });

    afterEach(() => {
        resetStepRecordNavigationStores();
        clearUndoHistory();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    describe('toggleStepRecordingForClip', () => {
        it('refuses to enable step input for a clip on a frozen track and warns once', () => {
            setClipTrackFrozen(true);
            stepRecordStore.set(makeStepRecordState({ active: false, clipId: null }));

            toggleStepRecordingForClip({ clipId: 'clip-a' });

            expect(stepRecordStore.value?.active).toBe(false);
            expect(stepRecordStore.value?.clipId).toBeNull();
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('enables step input for a clip on an unfrozen track without a warning', () => {
            setClipTrackFrozen(false);
            stepRecordStore.set(makeStepRecordState({ active: false, clipId: null }));

            toggleStepRecordingForClip({ clipId: 'clip-a' });

            expect(stepRecordStore.value?.active).toBe(true);
            expect(stepRecordStore.value?.clipId).toBe('clip-a');
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });

        it('still turns step input off when the clip track froze meanwhile', () => {
            setClipTrackFrozen(true);
            stepRecordStore.set(makeStepRecordState({ active: true, clipId: 'clip-a' }));

            toggleStepRecordingForClip({ clipId: 'clip-a' });

            expect(stepRecordStore.value?.active).toBe(false);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });
    });

    describe('toggleStepRecording', () => {
        it('refuses to enable step input for the selected clip on a frozen track and warns once', () => {
            setClipTrackFrozen(true);
            stepRecordStore.set(null);

            toggleStepRecording();

            expect(stepRecordStore.value).toBeNull();
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('enables step input for the selected clip on an unfrozen track without a warning', () => {
            setClipTrackFrozen(false);
            stepRecordStore.set(null);

            toggleStepRecording();

            expect(stepRecordStore.value).toMatchObject({ active: true, clipId: 'clip-a', currentBeat: 2 });
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });
    });

    describe('stepRecordNoteOn', () => {
        const activate = (): void => {
            stepRecordStore.set(makeStepRecordState({ active: true, clipId: 'clip-a', currentBeat: 4, stepSize: 0.5 }));
        };

        it('writes no note and no undo entry, and warns once, when the clip track froze after step input began', () => {
            setClipTrackFrozen(true);
            activate();

            stepRecordNoteOn(60, 80);

            expect(midiStore.value?.notesByClipId['clip-a'] ?? []).toEqual([]);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('writes the note and its undo entry without a warning on an unfrozen track', () => {
            setClipTrackFrozen(false);
            activate();

            stepRecordNoteOn(60, 80);

            expect(midiStore.value?.notesByClipId['clip-a']).toHaveLength(1);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });
    });
});
