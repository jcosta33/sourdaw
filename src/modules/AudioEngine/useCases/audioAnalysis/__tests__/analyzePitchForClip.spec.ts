import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzePitchForClip } from '../analyzePitchForClip';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { trackStore } from '#/modules/Arrangement/stores';
import { kneadStore } from '#/modules/Knead/stores';
import { isTauri } from '#/utils/tauriBridge';
import { getBufferForClip } from '#/modules/Arrangement/useCases';
import { analyze_pitch_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(() => true),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getBufferForClip: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => ({
    analyze_pitch_wasm: vi.fn(),
}));

describe('analyzePitchForClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(true);
        
        // Setup mock stores
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

        kneadStore.set({
            isAnalyzing: false,
            analysisProgress: 0,
        } as any);
    });

    it('should ignore if clip is not found or not audio', async () => {
        const result = await analyzePitchForClip('invalid-clip');
        expect(result).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(invoke).not.toHaveBeenCalled();
        
        const result2 = await analyzePitchForClip('c2');
        expect(result2).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(invoke).not.toHaveBeenCalled();
    });

    it('should set analyzing state, invoke command, and listen for progress in Tauri mode', async () => {
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        
        let resolveInvoke: any;
        const invokePromise = new Promise(resolve => { resolveInvoke = resolve; });
        vi.mocked(invoke).mockReturnValue(invokePromise as any);
        
        let progressCallback: any = null;
        const unlistenMock = vi.fn();
        vi.mocked(listen).mockImplementation((event, cb) => {
            progressCallback = cb;
            return Promise.resolve(unlistenMock);
        });
        
        const promise = analyzePitchForClip('c1');
        
        // Check state was set to analyzing
        expect(kneadStore.value.isAnalyzing).toBe(true);
        expect(kneadStore.value.analysisProgress).toBe(0);
        
        // Wait for listen to be registered
        await new Promise(resolve => setTimeout(resolve, 0));
        
        expect(listen).toHaveBeenCalledWith('pitch-analysis-progress', expect.any(Function));
        
        // Trigger progress callback before invoke resolves
        if (progressCallback) {
            progressCallback({ payload: { progress: 0.5 } });
            expect(kneadStore.value.analysisProgress).toBe(0.5);
        }
        
        // Now resolve invoke
        resolveInvoke(mockContour);
        
        const result = await promise;
        
        expect(invoke).toHaveBeenCalledWith('analyze_pitch', { audioPath: 'test.wav' });
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });
        
        // Wait another tick for finally block to finish store update if needed
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((kneadStore.value as any).contours?.c1).toEqual(mockContour);
        
        // Check final state
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(1);
        expect(unlistenMock).toHaveBeenCalled();
    });

    it('should fallback to WASM when isTauri is false', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const mockContour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
        
        vi.mocked(getBufferForClip).mockReturnValue({
            buffer: {
                sampleRate: 44100,
                getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
            }
        } as any);

        vi.mocked(analyze_pitch_wasm).mockReturnValue(JSON.stringify(mockContour));

        const result = await analyzePitchForClip('c1');
        
        expect(invoke).not.toHaveBeenCalled();
        expect(analyze_pitch_wasm).toHaveBeenCalled();
        expect(result).toEqual({ status: 'analyzed', contour: mockContour });
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(1);
    });

    it('should throw error in WASM mode if buffer is missing', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        vi.mocked(getBufferForClip).mockReturnValue(null);
        
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(analyzePitchForClip('c1')).rejects.toThrow('Could not get audio buffer for clip');
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should handle errors and restore state', async () => {
        vi.mocked(invoke).mockRejectedValue(new Error('Test error'));
        vi.mocked(listen).mockResolvedValue(vi.fn());
        
        // Suppress console.error
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await expect(analyzePitchForClip('c1')).rejects.toThrow('Test error');
        
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
        
        // Should restore analyzing state
        expect(kneadStore.value.isAnalyzing).toBe(false);
        expect(kneadStore.value.analysisProgress).toBe(1);
    });
    
    it('should handle missing track store safely', async () => {
        trackStore.set({} as any);
        const result = await analyzePitchForClip('c1');
        expect(result).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
    });
});