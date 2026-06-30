import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { isTauri } from '#/utils/tauriBridge';

import { commitNativePitchEdit } from '../commit-native-pitch-edit';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(() => true),
}));

describe('commitNativePitchEdit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(true);
    });

    it('should invoke the native commit command with the pitch edit request', async () => {
        const contour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];

        const result = await commitNativePitchEdit({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            segments,
            contour,
        });

        expect(invoke).toHaveBeenCalledWith('commit_pitch_edit', {
            request: {
                inputAudioPath: 'test.wav',
                outputAudioPath: 'test_pitch.wav',
                segments,
                contour,
            },
        });
        expect(result).toBe(true);
    });

    it('should return false without invoking native commit outside Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await commitNativePitchEdit({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            segments: [],
            contour: { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' },
        });

        expect(result).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });
});
