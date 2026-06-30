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
        type ProgressCallback = Parameters<typeof listen<{ progress: number }>>[1];

        const onProgress = vi.fn();
        const unlisten = vi.fn();
        let progressCallback: ProgressCallback | null = null;

        vi.mocked(listen).mockImplementation((_event, callback) => {
            progressCallback = callback;
            return Promise.resolve(unlisten);
        });

        const result = await listenPitchAnalysisProgress({ onProgress });
        progressCallback?.({
            event: 'pitch-analysis-progress',
            id: 1,
            payload: { progress: 0.42 },
        });
        result();

        expect(listen).toHaveBeenCalledWith('pitch-analysis-progress', expect.any(Function));
        expect(onProgress).toHaveBeenCalledWith(0.42);
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('should return null without subscribing outside Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const onProgress = vi.fn();

        const result = await listenPitchAnalysisProgress({ onProgress });

        expect(result).toBeNull();
        expect(listen).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });
});
