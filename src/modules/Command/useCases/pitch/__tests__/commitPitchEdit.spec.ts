import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitPitchEditCommand } from '../commitPitchEdit';
import { invoke } from '@tauri-apps/api/core';
import { trackStore } from '#/modules/Arrangement/stores';
import { commitUndoEntry } from '../../commitUndoEntry';
import { createCallbackUndoEntry } from '../../commandQueries';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('../../commitUndoEntry', () => ({
    commitUndoEntry: vi.fn(),
}));

vi.mock('../../commandQueries', () => ({
    createCallbackUndoEntry: vi.fn().mockImplementation((label, undo, redo, source) => ({
        label, undo, redo, source, kind: 'callback'
    })),
}));

describe('commitPitchEditCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup mock store
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', type: 'audio', fileId: 'test.wav' },
                        { id: 'c2', type: 'midi', fileId: undefined },
                    ]
                }
            ]
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
            }
        });
        
        expect(createCallbackUndoEntry).toHaveBeenCalledWith('Commit Pitch Edit', expect.any(Function), expect.any(Function), 'manual');
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