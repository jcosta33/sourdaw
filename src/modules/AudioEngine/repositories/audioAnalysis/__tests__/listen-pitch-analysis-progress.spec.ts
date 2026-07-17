import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listen } from '@tauri-apps/api/event';

import { isTauri } from '#/utils/tauriBridge';

import { listenPitchAnalysisProgress } from '../listen-pitch-analysis-progress';

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(() => true),
}));

describe('listenPitchAnalysisProgress', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(true);
    });

    it('should listen for native progress events and forward progress values', async () => {
        type ProgressCallback = Parameters<typeof listen<{ analysisId: string; progress: number }>>[1];

        const onProgress = vi.fn();
        const unlisten = vi.fn();
        const callbackHolder: { current: ProgressCallback | null } = { current: null };

        vi.mocked(listen).mockImplementation((_event, callback) => {
            callbackHolder.current = callback;
            return Promise.resolve(unlisten);
        });

        const result = await listenPitchAnalysisProgress({ analysisId: 'analysis-1', onProgress });
        const progressCallback = callbackHolder.current;
        if (!progressCallback) {
            throw new Error('expected the progress listener to be registered');
        }
        progressCallback({
            event: 'pitch-analysis-progress',
            id: 1,
            payload: { analysisId: 'analysis-2', progress: 0.9 },
        });
        progressCallback({
            event: 'pitch-analysis-progress',
            id: 2,
            payload: { analysisId: 'analysis-1', progress: 0.42 },
        });
        if (!result) {
            throw new Error('expected an unlisten function');
        }
        result();

        expect(listen).toHaveBeenCalledWith('pitch-analysis-progress', expect.any(Function));
        expect(onProgress).toHaveBeenCalledExactlyOnceWith(0.42);
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('should return null without subscribing outside Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const onProgress = vi.fn();

        const result = await listenPitchAnalysisProgress({ analysisId: 'analysis-1', onProgress });

        expect(result).toBeNull();
        expect(listen).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });
});
