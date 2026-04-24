import { describe, it, expect, vi, beforeEach } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { commit_pitch_edit_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';
import { isTauri } from '#/utils/tauriBridge';

import { createCallbackUndoEntry } from '../../commandQueries';
import { commitUndoEntry } from '../../commitUndoEntry';
import { commitPitchEditCommand } from '../commitPitchEdit';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
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

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(() => true),
}));

vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: {
        set: vi.fn(),
        get: vi.fn(),
    },
}));

vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => ({
    commit_pitch_edit_wasm: vi.fn(),
}));

describe('commitPitchEditCommand', () => {
    const AudioBufferMock = vi.fn(function AudioBufferMock(this: { copyToChannel: ReturnType<typeof vi.fn> }) {
        this.copyToChannel = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
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
        const undoFn = vi.mocked(createCallbackUndoEntry).mock.calls[0][1] as Function;
        undoFn();

        const restoredTracks = trackStore.value.tracks;
        expect(restoredTracks[0].clips[0].fileId).toBe('test.wav');
    });

    it('should fallback to WASM when isTauri is false', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const contour = { test: true };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];

        vi.mocked(audioBufferCache.get).mockReturnValue({
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        } as any);

        vi.mocked(commit_pitch_edit_wasm).mockReturnValue(new Float32Array(100));

        await commitPitchEditCommand('c1', segments, contour);

        expect(invoke).not.toHaveBeenCalled();
        expect(commit_pitch_edit_wasm).toHaveBeenCalled();
        expect(audioBufferCache.set).toHaveBeenCalledWith('test_pitch.wav', expect.any(Object));
        expect(commitUndoEntry).toHaveBeenCalled();
    });

    it('should throw error in WASM mode if buffer is missing', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        vi.mocked(audioBufferCache.get).mockReturnValue(undefined);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await commitPitchEditCommand('c1', [], {});
        expect(consoleSpy).toHaveBeenCalledWith(
            'Failed to commit pitch edit:',
            new Error('Could not get audio buffer for clip')
        );
        consoleSpy.mockRestore();
    });

    it('should catch and log errors', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(invoke).mockRejectedValueOnce(new Error('test error'));

        await commitPitchEditCommand('c1', [], {});

        expect(consoleSpy).toHaveBeenCalledWith('Failed to commit pitch edit:', new Error('test error'));

        consoleSpy.mockRestore();
    });

    it('should handle undefined tracks safely', async () => {
        trackStore.set({} as any);
        await commitPitchEditCommand('c1', [], {});
        expect(invoke).not.toHaveBeenCalled();
    });
});
