import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitNativePitchEdit } from '../../../repositories/audioAnalysis/commit-native-pitch-edit';
import { readNativeAudioFile } from '../../../repositories/audioAnalysis/read-native-audio-file';
import { audioBufferCache } from '../../../stores/audioBufferCache';
import { decodeAudioFileBuffer } from '../../decodeAudioFileBuffer';
import { commitPitchEdit } from '../commitPitchEdit';
import { processPitchEditWasm } from '../processPitchEditWasm';

vi.mock('../../../repositories/audioAnalysis/commit-native-pitch-edit', () => ({
    commitNativePitchEdit: vi.fn(),
}));

vi.mock('../../../repositories/audioAnalysis/read-native-audio-file', () => ({
    readNativeAudioFile: vi.fn(),
}));

vi.mock('../../decodeAudioFileBuffer', () => ({
    decodeAudioFileBuffer: vi.fn(),
}));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: vi.fn(),
        set: vi.fn(),
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

    // Nothing in either realm resolves a clip's audio from a path: the scheduler, the
    // offline renderer and project reload all key on `audioBufferId`. So a native
    // render sitting on disk and nowhere else is an inaudible commit — the file has to
    // come back through the decoder and into the cache under the id the clip will be
    // repointed at, exactly as on the WASM path.
    it('loads the native render back into the cache and reports its buffer id', async () => {
        const contour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];
        const renderedFile = new File([new Uint8Array([1, 2, 3])], 'test_pitch.wav');
        const renderedBuffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 44100 });
        vi.mocked(commitNativePitchEdit).mockResolvedValue(true);
        vi.mocked(readNativeAudioFile).mockResolvedValue(renderedFile);
        vi.mocked(decodeAudioFileBuffer).mockResolvedValue(renderedBuffer);

        const result = await commitPitchEdit({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            outputAudioBufferId: 'audio-pitch:test_pitch.wav',
            audioBufferId: 'buffer-c1',
            segments,
            contour,
        });

        expect(commitNativePitchEdit).toHaveBeenCalledWith({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            segments,
            contour,
        });
        expect(readNativeAudioFile).toHaveBeenCalledWith({ path: 'test_pitch.wav' });
        expect(decodeAudioFileBuffer).toHaveBeenCalledWith(renderedFile);
        expect(audioBufferCache.set).toHaveBeenCalledWith('audio-pitch:test_pitch.wav', renderedBuffer);
        expect(result).toEqual({ renderedAudioBufferId: 'audio-pitch:test_pitch.wav' });
        // The source buffer is never touched natively: the render came from the file.
        expect(audioBufferCache.get).not.toHaveBeenCalled();
        expect(processPitchEditWasm).not.toHaveBeenCalled();
    });

    // Degrading to a "successful" commit here would repoint the clip at a file this
    // realm cannot read, clear the blobs and the contour, and leave the old audio
    // playing — the edit destroyed and the bake inert, with nothing on screen to say
    // so. Failing instead rolls the action back and keeps the edit re-committable.
    it('fails the commit when the native render cannot be decoded', async () => {
        vi.mocked(commitNativePitchEdit).mockResolvedValue(true);
        vi.mocked(readNativeAudioFile).mockResolvedValue(new File([], 'test_pitch.wav'));
        vi.mocked(decodeAudioFileBuffer).mockRejectedValue(new Error('format not supported'));

        await expect(
            commitPitchEdit({
                inputAudioPath: 'test.wav',
                outputAudioPath: 'test_pitch.wav',
                outputAudioBufferId: 'audio-pitch:test_pitch.wav',
                audioBufferId: 'buffer-c1',
                segments: [],
                contour: { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' },
            })
        ).rejects.toThrow('format not supported');

        expect(audioBufferCache.set).not.toHaveBeenCalled();
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
