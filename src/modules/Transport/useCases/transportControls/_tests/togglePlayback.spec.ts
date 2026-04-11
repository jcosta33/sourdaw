import { describe, it, expect, vi, beforeEach } from 'vitest';
import { togglePlayback } from '../togglePlayback';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { pausePlayback } from '../pausePlayback';
import { startPlayback } from '../startPlayback';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';

vi.mock('../pausePlayback', () => ({
    pausePlayback: vi.fn(),
}));
vi.mock('../startPlayback', () => ({
    startPlayback: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('togglePlayback', () => {
    beforeEach(() => {
        vi.mocked(pausePlayback).mockClear();
        vi.mocked(startPlayback).mockClear();
        vi.mocked(getTransportState).mockClear();
    });

    it('should load pausePlayback when transport is playing', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });

        togglePlayback();

        await vi.waitFor(() => {
            expect(pausePlayback).toHaveBeenCalled();
        });
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('should load startPlayback when transport is stopped', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false });

        togglePlayback();

        await vi.waitFor(() => {
            expect(startPlayback).toHaveBeenCalled();
        });
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('should not dynamic-import when transport state is missing', async () => {
        vi.mocked(getTransportState).mockReturnValue(null as any);

        togglePlayback();

        await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
        });

        expect(pausePlayback).not.toHaveBeenCalled();
        expect(startPlayback).not.toHaveBeenCalled();
    });
});
