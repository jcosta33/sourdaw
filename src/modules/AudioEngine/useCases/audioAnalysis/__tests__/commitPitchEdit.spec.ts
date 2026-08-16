import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitNativePitchEdit } from '../../../repositories/audioAnalysis/commit-native-pitch-edit';
import { audioBufferCache } from '../../../stores/audioBufferCache';
import { commitPitchEdit } from '../commitPitchEdit';
import { processPitchEditWasm } from '../processPitchEditWasm';

vi.mock('../../../repositories/audioAnalysis/commit-native-pitch-edit', () => ({
    commitNativePitchEdit: vi.fn(),
}));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: vi.fn(),
    },
}));

vi.mock('../processPitchEditWasm', () => ({
    processPitchEditWasm: vi.fn(),
}));

describe('commitPitchEdit', () => {
    const AudioBufferMock = vi.fn(function AudioBufferMock(options: AudioBufferOptions) {
        return {
            length: options.length,
            numberOfChannels: options.numberOfChannels,
            sampleRate: options.sampleRate,
            duration: options.length / options.sampleRate,
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            getChannelData: vi.fn().mockReturnValue(new Float32Array(options.length)),
        };
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioBuffer', AudioBufferMock);
    });

    it('should commit through the native repository when Tauri commit is available', async () => {
        const contour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];
        vi.mocked(commitNativePitchEdit).mockResolvedValue(true);

        const result = await commitPitchEdit({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            outputAudioBufferId: 'audio-pitch:test_pitch.wav',
            audioBufferId: 'buffer-c1',
            segments,
            contour,
        });

        // The native path writes a file and decodes nothing into this realm's cache, so
        // it reports no buffer — repointing the clip at an uncached key would silence it.
        expect(result).toEqual({ renderedAudioBufferId: null });
        expect(commitNativePitchEdit).toHaveBeenCalledWith({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            segments,
            contour,
        });
        expect(audioBufferCache.get).not.toHaveBeenCalled();
        expect(processPitchEditWasm).not.toHaveBeenCalled();
    });

    it('should fallback to WASM and cache under the buffer id when native commit is unavailable', async () => {
        const contour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];
        const originalBuffer = new AudioBuffer({
            length: 100,
            numberOfChannels: 1,
            sampleRate: 44100,
        });

        vi.mocked(commitNativePitchEdit).mockResolvedValue(false);
        vi.mocked(audioBufferCache.get).mockReturnValue(originalBuffer);

        const result = await commitPitchEdit({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            outputAudioBufferId: 'audio-pitch:test_pitch.wav',
            audioBufferId: 'buffer-c1',
            segments,
            contour,
        });

        expect(audioBufferCache.get).toHaveBeenCalledWith('buffer-c1');
        // Cached under a buffer id, not the output path: playback, export and the next
        // pitch analysis all resolve a clip's audio through `audioBufferId`, so a render
        // keyed by path was reachable by nothing.
        expect(processPitchEditWasm).toHaveBeenCalledWith(
            originalBuffer,
            segments,
            contour,
            'audio-pitch:test_pitch.wav'
        );
        // Reported back so the caller can repoint the clip at the render.
        expect(result).toEqual({ renderedAudioBufferId: 'audio-pitch:test_pitch.wav' });
    });

    it('should throw when native commit is unavailable and the source buffer is missing', async () => {
        vi.mocked(commitNativePitchEdit).mockResolvedValue(false);
        vi.mocked(audioBufferCache.get).mockReturnValue(undefined);

        await expect(
            commitPitchEdit({
                inputAudioPath: 'test.wav',
                outputAudioPath: 'test_pitch.wav',
                outputAudioBufferId: 'audio-pitch:test_pitch.wav',
                audioBufferId: 'buffer-c1',
                segments: [],
                contour: { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' },
            })
        ).rejects.toThrow('Could not get audio buffer for clip');

        expect(processPitchEditWasm).not.toHaveBeenCalled();
    });
});
