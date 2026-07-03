import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, type Clip, type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { type PitchContour } from '#/modules/Knead/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { commitUndoEntry } from '../../commitUndoEntry';
import { type createCallbackUndoEntry } from '../../createCallbackUndoEntry';
import { commitPitchEditCommand } from '../commitPitchEdit';
import { setPitchEditDependencies } from '../pitchEditDependencies';

const createCallbackUndoEntryCalls = vi.hoisted<{
    inputs: Parameters<typeof createCallbackUndoEntry>[0][];
}>(() => ({ inputs: [] }));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn() },
}));

vi.mock('../../commitUndoEntry', () => ({
    commitUndoEntry: vi.fn(),
}));

vi.mock('../../createCallbackUndoEntry', () => ({
    createCallbackUndoEntry: vi.fn().mockImplementation((input: Parameters<typeof createCallbackUndoEntry>[0]) => {
        createCallbackUndoEntryCalls.inputs.push(input);
        const { label, undo, redo, source = 'manual' } = input;
        return {
            id: 'undo-test',
            label,
            undo,
            redo,
            timestamp: 1,
            source,
            kind: 'callback',
        };
    }),
}));

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

const commitPitchEditMock = vi.fn();

type PitchEditTestClip = Clip & {
    fileId?: string;
};

function createClip(overrides: Partial<PitchEditTestClip>): PitchEditTestClip {
    return {
        id: 'clip-1',
        trackId: 't1',
        name: 'Clip 1',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createTrack(overrides: Partial<Track>): Track {
    return {
        id: 't1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function getFirstClipFileId(): string | undefined {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip || !('fileId' in clip)) {
        return undefined;
    }

    if (typeof clip.fileId !== 'string') {
        return undefined;
    }

    return clip.fileId;
}

describe('commitPitchEditCommand', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
        setPitchEditDependencies({
            commitPitchEdit: commitPitchEditMock,
        });
        commitPitchEditMock.mockResolvedValue(undefined);
        createCallbackUndoEntryCalls.inputs = [];

        const state = {
            tracks: [
                createTrack({
                    clips: [
                        { id: 'c1', type: 'audio', fileId: 'test.wav', audioBufferId: 'buffer-c1' },
                        { id: 'c2', type: 'midi', fileId: undefined },
                    ].map((clip) => createClip(clip)),
                }),
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        } satisfies TrackStoreState;
        trackStore.set(state);
    });

    it('should ignore if clip is not found or not audio', async () => {
        await commitPitchEditCommand('invalid-clip', [], {});
        expect(commitPitchEditMock).not.toHaveBeenCalled();

        await commitPitchEditCommand('c2', [], {});
        expect(commitPitchEditMock).not.toHaveBeenCalled();
    });

    it('should delegate pitch rendering to AudioEngine and register undo command', async () => {
        const contour: PitchContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];

        await commitPitchEditCommand('c1', segments, contour);

        expect(commitPitchEditMock).toHaveBeenCalledWith({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            audioBufferId: 'buffer-c1',
            segments,
            contour,
        });

        expect(createCallbackUndoEntryCalls.inputs).toHaveLength(1);
        expect(createCallbackUndoEntryCalls.inputs[0]?.label).toBe('Commit Pitch Edit');
        expect(createCallbackUndoEntryCalls.inputs[0]?.source).toBe('manual');
        expect(commitUndoEntry).toHaveBeenCalled();

        expect(getFirstClipFileId()).toBe('test_pitch.wav');

        const committedEntry = vi.mocked(commitUndoEntry).mock.calls[0][0];
        if (committedEntry.kind !== 'callback') {
            throw new Error('Expected callback undo entry');
        }

        committedEntry.undo();
        expect(getFirstClipFileId()).toBe('test.wav');

        committedEntry.redo();
        expect(getFirstClipFileId()).toBe('test_pitch.wav');
    });

    it('should log and notify users when AudioEngine pitch rendering fails', async () => {
        commitPitchEditMock.mockRejectedValueOnce(new Error('test error'));

        await commitPitchEditCommand('c1', [], {});

        expect(logger.error).toHaveBeenCalledWith(new Error('test error'));
        expect(mockNotificationEventBus.emit).toHaveBeenCalledWith('ui.notify', {
            message: 'Failed to commit pitch edit',
            level: 'error',
        });
        expect(commitUndoEntry).not.toHaveBeenCalled();
    });

    it('should handle undefined tracks safely', async () => {
        trackStore.set(null);
        await commitPitchEditCommand('c1', [], {});
        expect(commitPitchEditMock).not.toHaveBeenCalled();
    });
});
