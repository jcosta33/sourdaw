import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { togglePlayback } from './togglePlayback';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { pausePlayback } from './pausePlayback';
import { startPlayback } from './startPlayback';

vi.mock('./pausePlayback', () => ({
    pausePlayback: vi.fn(),
}));
vi.mock('./startPlayback', () => ({
    startPlayback: vi.fn(),
}));

describe('togglePlayback', () => {
    beforeEach(() => {
        vi.mocked(pausePlayback).mockClear();
        vi.mocked(startPlayback).mockClear();
    });

    it('should load pausePlayback when transport is playing', async () => {
        injectDependencies(togglePlayback, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, isPlaying: true })),
        });

        togglePlayback();

        await vi.waitFor(() => {
            expect(pausePlayback).toHaveBeenCalled();
        });
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('should load startPlayback when transport is stopped', async () => {
        injectDependencies(togglePlayback, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, isPlaying: false })),
        });

        togglePlayback();

        await vi.waitFor(() => {
            expect(startPlayback).toHaveBeenCalled();
        });
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('should not dynamic-import when transport state is missing', async () => {
        injectDependencies(togglePlayback, {
            getTransportState: vi.fn(() => null),
        });

        togglePlayback();

        await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
        });

        expect(pausePlayback).not.toHaveBeenCalled();
        expect(startPlayback).not.toHaveBeenCalled();
    });
});
