import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioContext } from '#/modules/AudioEngine/useCases';

import { usePreviewAudio } from '../usePreviewAudio';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: vi.fn(),
}));

type FakeNode = {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    frequency: { value: number };
    type: string;
    onended: (() => void) | null;
};

function makeFakeContext(): { ctx: unknown; oscillators: FakeNode[] } {
    const oscillators: FakeNode[] = [];
    const gain = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
    const ctx = {
        state: 'running',
        currentTime: 0,
        resume: vi.fn(),
        destination: {},
        createGain: vi.fn(() => gain),
        createOscillator: vi.fn(() => {
            const osc: FakeNode = {
                connect: vi.fn(),
                disconnect: vi.fn(),
                stop: vi.fn(),
                start: vi.fn(),
                frequency: { value: 0 },
                type: 'sine',
                onended: null,
            };
            oscillators.push(osc);
            return osc;
        }),
    };
    return { ctx, oscillators };
}

describe('usePreviewAudio — unmount cleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stops and disconnects a sounding preview node when the component unmounts', () => {
        const { ctx, oscillators } = makeFakeContext();
        vi.mocked(getAudioContext).mockReturnValue(ctx as AudioContext);

        const { result, unmount } = renderHook(() => usePreviewAudio());

        // Start a tone — sourceRef now holds a live oscillator.
        act(() => {
            result.current.playTone('preview-1', 440, 5);
        });

        expect(oscillators).toHaveLength(1);
        const osc = oscillators[0]!;
        expect(osc.start).toHaveBeenCalledTimes(1);
        // playTone schedules an osc.stop(currentTime + dur) but the node is still
        // connected to the graph mid-playback — disconnect has not run yet.
        expect(osc.disconnect).not.toHaveBeenCalled();

        unmount();

        // Unmount-mid-playback must release the node graph: stop the source and
        // disconnect it from ctx.destination.
        expect(osc.stop).toHaveBeenCalled();
        expect(osc.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does not throw on unmount when nothing is playing', () => {
        const { ctx } = makeFakeContext();
        vi.mocked(getAudioContext).mockReturnValue(ctx as AudioContext);

        const { unmount } = renderHook(() => usePreviewAudio());

        expect(() => unmount()).not.toThrow();
    });
});
