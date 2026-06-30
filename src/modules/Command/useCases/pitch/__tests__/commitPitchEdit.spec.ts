import { describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- test file: must mock Tauri APIs at their source
import { invoke } from '@tauri-apps/api/core';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri } from '#/utils/tauriBridge';

import { createCallbackUndoEntry } from '../../commandQueries';
import { commitUndoEntry } from '../../commitUndoEntry';
import { commitPitchEditCommand } from '../commitPitchEdit';
import { setPitchEditDependencies } from '../pitchEditDependencies';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn() },
}));

vi.mock('../../commitUndoEntry', () => ({
    commitUndoEntry: vi.fn(),
}));

vi.mock('../../commandQueries', () => ({
    createCallbackUndoEntry: vi.fn().mockImplementation((label, undo, redo, source) => ({
        label,
        undo,
        redo,
        source,
        kind: 'callback',
    })),
}));

vi.mock('#/utils/tauriBridge', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/utils/tauriBridge')>()),
    isTauri: vi.fn(() => true),
}));

vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: {
        set: vi.fn(),
        get: vi.fn(),
    },
}));

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

const processPitchEditWasmMock = vi.fn();

describe('commitPitchEditCommand', () => {
    const AudioBufferMock = vi.fn(function AudioBufferMock(this: { copyToChannel: ReturnType<typeof vi.fn> }) {
        this.copyToChannel = vi.fn();
    });

    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
        setPitchEditDependencies({
            processPitchEditWasm: processPitchEditWasmMock,
        });
        vi.mocked(isTauri).mockReturnValue(true);
        vi.stubGlobal('AudioBuffer', AudioBufferMock);

        // Setup mock store
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', type: 'audio', fileId: 'test.wav', audioBufferId: 'buffer-c1' },
                        { id: 'c2', type: 'midi', fileId: undefined },
                    ],
                },
            ],
        } as any);
    });

    it('should ignore if clip is not found or not audio', async () => {
        await commitPitchEditCommand('invalid-clip', [], {});
        expect(invoke).not.toHaveBeenCalled();

        await commitPitchEditCommand('c2', [], {});
        expect(invoke).not.toHaveBeenCalled();
    });

    it('should process offline and register undo command', async () => {
        const contour = { test: true };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];

        await commitPitchEditCommand('c1', segments, contour);

        expect(invoke).toHaveBeenCalledWith('commit_pitch_edit', {
            request: {
                inputAudioPath: 'test.wav',
                outputAudioPath: 'test_pitch.wav',
                segments,
                contour,
            },
        });

        expect(createCallbackUndoEntry).toHaveBeenCalledWith(
            'Commit Pitch Edit',
            expect.any(Function),
            expect.any(Function),
            'manual'
        );
        expect(commitUndoEntry).toHaveBeenCalled();

        // Verify redo changes the fileId
        const newTracks = trackStore.value.tracks;
        expect(newTracks[0].clips[0].fileId).toBe('test_pitch.wav');

        // Verify undo changes it back
        const undoFn = vi.mocked(createCallbackUndoEntry).mock.calls[0][1] as () => void;
        undoFn();

        const restoredTracks = trackStore.value.tracks;
        expect(restoredTracks[0].clips[0].fileId).toBe('test.wav');
    });

    it('should fallback to WASM when isTauri is false', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const contour = { test: true };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];
        let renderedBuffer: AudioBuffer | null = null;

        processPitchEditWasmMock.mockImplementation(
            (
                originalBuffer: AudioBuffer,
                segmentsArgument: unknown[],
                contourArgument: unknown,
                outputAudioPath: string
            ) => {
                expect(segmentsArgument).toBe(segments);
                expect(contourArgument).toBe(contour);
                renderedBuffer = new AudioBuffer({
                    length: originalBuffer.length,
                    numberOfChannels: 1,
                    sampleRate: originalBuffer.sampleRate,
                });
                audioBufferCache.set(outputAudioPath, renderedBuffer);
            }
        );

        vi.mocked(audioBufferCache.get).mockReturnValue({
            length: 100,
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        } as any);

        await commitPitchEditCommand('c1', segments, contour);

        expect(invoke).not.toHaveBeenCalled();
        expect(processPitchEditWasmMock).toHaveBeenCalledWith(
            expect.objectContaining({ sampleRate: 44100 }),
            segments,
            contour,
            'test_pitch.wav'
        );
        expect(renderedBuffer).not.toBeNull();
        expect(audioBufferCache.set).toHaveBeenCalledWith('test_pitch.wav', renderedBuffer);
        expect(commitUndoEntry).toHaveBeenCalled();
    });

    it('should throw error in WASM mode if buffer is missing', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        vi.mocked(audioBufferCache.get).mockReturnValue(undefined);

        await commitPitchEditCommand('c1', [], {});

        expect(logger.error).toHaveBeenCalledWith(new Error('Could not get audio buffer for clip'));
    });

    it('should catch and log errors', async () => {
        vi.mocked(invoke).mockRejectedValueOnce(new Error('test error'));

        await commitPitchEditCommand('c1', [], {});

        expect(logger.error).toHaveBeenCalledWith(new Error('test error'));
    });

    it('should handle undefined tracks safely', async () => {
        trackStore.set({} as any);
        await commitPitchEditCommand('c1', [], {});
        expect(invoke).not.toHaveBeenCalled();
    });
});
