import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { analyze_pitch_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';

import { analyzeNativePitch } from '../../../repositories/audioAnalysis/analyze-native-pitch';
import { listenPitchAnalysisProgress } from '../../../repositories/audioAnalysis/listen-pitch-analysis-progress';
import { audioBufferCache } from '../../../stores/audioBufferCache';
import { analyzePitchForClip } from '../analyzePitchForClip';

vi.mock('../../../repositories/audioAnalysis/analyze-native-pitch', () => ({
    analyzeNativePitch: vi.fn(),
}));

vi.mock('../../../repositories/audioAnalysis/listen-pitch-analysis-progress', () => ({
    listenPitchAnalysisProgress: vi.fn(),
}));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: vi.fn(),
    },
}));

// The default export is the wasm-bindgen main-thread init (`__wbg_init`). It
// MUST be invoked before `analyze_pitch_wasm` reads the glue — otherwise the
// glue singleton is uninitialized and the call throws
// `Cannot read properties of undefined (reading '__wbindgen_free')`.
const { initModule } = vi.hoisted(() => ({ initModule: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => ({
    __esmodule: true,
    default: initModule,
    analyze_pitch_wasm: vi.fn(),
}));

describe('analyzePitchForClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Setup mock stores
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
        const onStart = vi.fn();
        const result = await analyzePitchForClip({ clipId: 'invalid-clip', onStart, onProgress: vi.fn() });
        expect(result).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(analyzeNativePitch).not.toHaveBeenCalled();

        const result2 = await analyzePitchForClip({ clipId: 'c2', onStart, onProgress: vi.fn() });
        expect(result2).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(analyzeNativePitch).not.toHaveBeenCalled();
        expect(onStart).not.toHaveBeenCalled();
    });

    it('analyzes natively and forwards progress in desktop mode', async () => {
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };

        let resolveAnalyzeNativePitch: (contour: typeof mockContour) => void = () => {};
        const analyzeNativePitchPromise = new Promise<typeof mockContour>((resolve) => {
            resolveAnalyzeNativePitch = resolve;
        });
        vi.mocked(analyzeNativePitch).mockReturnValue(analyzeNativePitchPromise);

        const progressListener: { callback?: (progress: number) => void } = {};
        const unlistenMock = vi.fn();
        vi.mocked(listenPitchAnalysisProgress).mockImplementation(({ onProgress }) => {
            progressListener.callback = onProgress;
            return Promise.resolve(unlistenMock);
        });

        const onStart = vi.fn();
        const onProgress = vi.fn();
        const promise = analyzePitchForClip({ clipId: 'c1', onStart, onProgress });

        // Wait for listen to be registered
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(onStart).toHaveBeenCalledTimes(1);
        expect(listenPitchAnalysisProgress).toHaveBeenCalledWith({
            analysisId: expect.any(String),
            onProgress: expect.any(Function),
        });

        // Trigger progress callback before invoke resolves
        const progressCallback = progressListener.callback;
        if (!progressCallback) {
            throw new Error('Expected native progress listener to be registered');
        }

        progressCallback(0.5);
        expect(onProgress).toHaveBeenCalledWith(0.5);

        // Now resolve native analysis
        resolveAnalyzeNativePitch(mockContour);

        const result = await promise;

        const analysisId = vi.mocked(listenPitchAnalysisProgress).mock.calls[0]?.[0].analysisId;
        expect(analyzeNativePitch).toHaveBeenCalledWith({ analysisId, audioPath: 'test.wav' });
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });
        expect(unlistenMock).toHaveBeenCalled();
    });

    it('should pass the audio buffer id to native analysis when file id is missing', async () => {
        const currentTrackState = trackStore.value;
        if (!currentTrackState) {
            throw new Error('expected the track store to be seeded');
        }
        trackStore.set({
            ...currentTrackState,
            tracks: currentTrackState.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => {
                    if (clip.id !== 'c1') {
                        return clip;
                    }

                    return {
                        ...clip,
                        fileId: undefined,
                    };
                }),
            })),
        });
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(vi.fn());
        vi.mocked(analyzeNativePitch).mockResolvedValue(mockContour);

        await analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress: vi.fn() });

        expect(analyzeNativePitch).toHaveBeenCalledWith({
            analysisId: expect.any(String),
            audioPath: 'buffer-c1',
        });
    });

    it('should fallback to WASM when native progress listening is unavailable', async () => {
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        const onProgress = vi.fn();

        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(null);
        vi.mocked(audioBufferCache.get).mockReturnValue({
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        } as any);

        vi.mocked(analyze_pitch_wasm).mockReturnValue(JSON.stringify(mockContour));

        const result = await analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress });

        expect(listenPitchAnalysisProgress).toHaveBeenCalledWith({
            analysisId: expect.any(String),
            onProgress: expect.any(Function),
        });
        expect(analyzeNativePitch).not.toHaveBeenCalled();
        expect(analyze_pitch_wasm).toHaveBeenCalled();
        // Regression: the daw_dsp wasm-bindgen module must be initialized on
        // the main thread before analyze_pitch_wasm reads its glue. Without it
        // the call threw `Cannot read properties of undefined (reading
        // '__wbindgen_free')` on every browser-side Knead analysis.
        expect(initModule).toHaveBeenCalled();
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });
        expect(onProgress).toHaveBeenNthCalledWith(1, 0.2);
        expect(onProgress).toHaveBeenNthCalledWith(2, 0.5);
        expect(onProgress).toHaveBeenNthCalledWith(3, 0.8);
    });

    it('should throw error in WASM mode if buffer is missing', async () => {
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(null);
        vi.mocked(audioBufferCache.get).mockReturnValue(undefined);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress: vi.fn() })).rejects.toThrow(
            'Could not get audio buffer for clip'
        );
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should fallback to WASM and clean up native progress listening when native analysis is unavailable', async () => {
        const unlistenMock = vi.fn();
        const wasmContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(unlistenMock);
        vi.mocked(analyzeNativePitch).mockResolvedValue(null);
        vi.mocked(audioBufferCache.get).mockReturnValue({
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        } as any);
        vi.mocked(analyze_pitch_wasm).mockReturnValue(JSON.stringify(wasmContour));

        const result = await analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress: vi.fn() });

        expect(analyzeNativePitch).toHaveBeenCalledWith({
            analysisId: expect.any(String),
            audioPath: 'test.wav',
        });
        expect(analyze_pitch_wasm).toHaveBeenCalled();
        expect(result).toEqual({ status: 'analyzed', contour: wasmContour });
        expect(unlistenMock).toHaveBeenCalledTimes(1);
    });

    it('should handle errors and restore state', async () => {
        const unlistenMock = vi.fn();
        vi.mocked(analyzeNativePitch).mockRejectedValue(new Error('Test error'));
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(unlistenMock);

        // Suppress console.error
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress: vi.fn() })).rejects.toThrow(
            'Test error'
        );

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();

        expect(unlistenMock).toHaveBeenCalled();
    });

    it('should handle missing track store safely', async () => {
        trackStore.set({} as any);
        const result = await analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress: vi.fn() });
        expect(result).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
    });

    it('returns raw contour data for the caller to hand off to Knead', async () => {
        const voicedPoints = Array.from({ length: 8 }, (_, index) => ({
            time_ms: index * 10,
            frequency_hz: 440,
            confidence: 0.9,
            voiced: true,
        }));
        const mockContour = {
            points: voicedPoints,
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        };
        vi.mocked(analyzeNativePitch).mockResolvedValue(mockContour);
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(vi.fn());

        const result = await analyzePitchForClip({ clipId: 'c1', onStart: vi.fn(), onProgress: vi.fn() });
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });
    });
});
