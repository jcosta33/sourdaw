import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { analyze_pitch_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';
import { kneadStore } from '#/modules/Knead/stores';

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

vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => ({
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

        // Seed the full KneadStoreState shape that production always carries
        // (defaultKneadState). analyzePitchForClip writes `contours`, so a
        // partial fixture would drop that write.
        kneadStore.set({
            activeClipId: null,
            clips: {},
            contours: {},
            isAnalyzing: false,
            analysisProgress: 0,
        } as any);
    });

    it('should ignore if clip is not found or not audio', async () => {
        const result = await analyzePitchForClip('invalid-clip');
        expect(result).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(analyzeNativePitch).not.toHaveBeenCalled();

        const result2 = await analyzePitchForClip('c2');
        expect(result2).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(analyzeNativePitch).not.toHaveBeenCalled();
    });

    it('should set analyzing state, analyze natively, and listen for progress in Tauri mode', async () => {
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };

        let resolveAnalyzeNativePitch: (contour: typeof mockContour) => void = () => {};
        const analyzeNativePitchPromise = new Promise<typeof mockContour>((resolve) => {
            resolveAnalyzeNativePitch = resolve;
        });
        vi.mocked(analyzeNativePitch).mockReturnValue(analyzeNativePitchPromise);

        let progressCallback: ((progress: number) => void) | null = null;
        const unlistenMock = vi.fn();
        vi.mocked(listenPitchAnalysisProgress).mockImplementation(({ onProgress }) => {
            progressCallback = onProgress;
            return Promise.resolve(unlistenMock);
        });

        const promise = analyzePitchForClip('c1');

        // Check state was set to analyzing
        expect(kneadStore.value.isAnalyzing).toBe(true);
        expect(kneadStore.value.analysisProgress).toBe(0);

        // Wait for listen to be registered
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(listenPitchAnalysisProgress).toHaveBeenCalledWith({ onProgress: expect.any(Function) });

        // Trigger progress callback before invoke resolves
        if (progressCallback) {
            progressCallback(0.5);
            expect(kneadStore.value.analysisProgress).toBe(0.5);
        }

        // Now resolve native analysis
        resolveAnalyzeNativePitch(mockContour);

        const result = await promise;

        expect(analyzeNativePitch).toHaveBeenCalledWith({ audioPath: 'test.wav' });
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });

        // Wait another tick for finally block to finish store update if needed
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect((kneadStore.value as any).contours?.c1).toEqual(mockContour);

        // Check final state
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(1);
        expect(unlistenMock).toHaveBeenCalled();
    });

    it('should pass the audio buffer id to native analysis when file id is missing', async () => {
        trackStore.set({
            ...trackStore.value,
            tracks: trackStore.value.tracks.map((track) => ({
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

        await analyzePitchForClip('c1');

        expect(analyzeNativePitch).toHaveBeenCalledWith({ audioPath: 'buffer-c1' });
    });

    it('should fallback to WASM when native progress listening is unavailable', async () => {
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };

        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(null);
        vi.mocked(audioBufferCache.get).mockReturnValue({
            sampleRate: 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        } as any);

        vi.mocked(analyze_pitch_wasm).mockReturnValue(JSON.stringify(mockContour));

        const result = await analyzePitchForClip('c1');

        expect(listenPitchAnalysisProgress).toHaveBeenCalledWith({ onProgress: expect.any(Function) });
        expect(analyzeNativePitch).not.toHaveBeenCalled();
        expect(analyze_pitch_wasm).toHaveBeenCalled();
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(1);
    });

    it('should throw error in WASM mode if buffer is missing', async () => {
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(null);
        vi.mocked(audioBufferCache.get).mockReturnValue(undefined);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(analyzePitchForClip('c1')).rejects.toThrow('Could not get audio buffer for clip');
        expect(consoleSpy).toHaveBeenCalled();
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(0);
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

        const result = await analyzePitchForClip('c1');

        expect(analyzeNativePitch).toHaveBeenCalledWith({ audioPath: 'test.wav' });
        expect(analyze_pitch_wasm).toHaveBeenCalled();
        expect(result).toEqual({ status: 'analyzed', contour: wasmContour });
        expect(unlistenMock).toHaveBeenCalledTimes(1);
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(1);
    });

    it('should handle errors and restore state', async () => {
        const unlistenMock = vi.fn();
        vi.mocked(analyzeNativePitch).mockRejectedValue(new Error('Test error'));
        vi.mocked(listenPitchAnalysisProgress).mockResolvedValue(unlistenMock);

        // Suppress console.error
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(analyzePitchForClip('c1')).rejects.toThrow('Test error');

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();

        // Should restore analyzing state
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(0);
        expect(unlistenMock).toHaveBeenCalled();
    });

    it('should handle missing track store safely', async () => {
        trackStore.set({} as any);
        const result = await analyzePitchForClip('c1');
        expect(result).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
    });

    it('writes the raw contour and returns it without ingesting blobs (ingestion is the Knead side)', async () => {
        // Blob ingestion moved to the Knead-side orchestrator `analyzeClipPitch`
        // so AudioEngine never imports the Knead use-case barrel (cycle). This
        // unit's job is the raw contour: it writes `contours[clipId]` for the
        // editor's faint background trace and returns the contour for the
        // orchestrator to ingest — it must NOT touch `clips`/`blobs` itself.
        kneadStore.set({
            activeClipId: null,
            clips: {},
            contours: {},
            isAnalyzing: false,
            analysisProgress: 0,
        });

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

        const result = await analyzePitchForClip('c1');
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });

        // The raw contour landed for the background trace.
        expect((kneadStore.value as any).contours?.c1).toEqual(mockContour);
        // But this unit did not ingest blobs — `clips` is untouched.
        expect(kneadStore.value.clips.c1).toBeUndefined();
    });
});
