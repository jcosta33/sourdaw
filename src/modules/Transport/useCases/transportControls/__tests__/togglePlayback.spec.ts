import { describe, it, expect, vi, beforeEach } from 'vitest';

import { togglePlayback } from '../togglePlayback';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    pausePlayback: vi.fn(),
    startPlayback: vi.fn(),
}));

// Mock the repository file directly as used in togglePlayback.ts
vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: mocks.getTransportState,
}));

// Mock the controls files directly
vi.mock('../pausePlayback', () => ({ pausePlayback: mocks.pausePlayback }));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));

describe('togglePlayback', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls startPlayback if not playing', async () => {
        mocks.getTransportState.mockReturnValue({ isPlaying: false });
        togglePlayback();
        await vi.waitFor(() => {
            expect(mocks.startPlayback).toHaveBeenCalled();
        });
    });

    it('calls pausePlayback if playing', async () => {
        mocks.getTransportState.mockReturnValue({ isPlaying: true });
        togglePlayback();
        await vi.waitFor(() => {
            expect(mocks.pausePlayback).toHaveBeenCalled();
        });
    });
});
