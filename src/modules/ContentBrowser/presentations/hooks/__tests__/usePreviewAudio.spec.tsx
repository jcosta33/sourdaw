import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockGetAudioContext } = vi.hoisted(() => ({
    mockGetAudioContext: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: mockGetAudioContext,
}));

import { usePreviewAudio } from '../usePreviewAudio';

function makeMockContext() {
    const gain = {
        gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
    const source = {
        buffer: null as AudioBuffer | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
    };
    const oscillator = {
        frequency: { value: 440 },
        type: 'sine',
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
    };
    const ctx = {
        state: 'running',
        currentTime: 0,
        resume: vi.fn().mockResolvedValue(undefined),
        destination: {},
        createBufferSource: vi.fn(() => source),
        createOscillator: vi.fn(() => oscillator),
        createGain: vi.fn(() => gain),
    };
    return { ctx, gain, source, oscillator };
}

describe('usePreviewAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a PreviewHandle with playingId null initially', () => {
        mockGetAudioContext.mockReturnValue(makeMockContext().ctx);
        const { result } = renderHook(() => usePreviewAudio());
        expect(result.current.playingId).toBeNull();
        expect(typeof result.current.play).toBe('function');
        expect(typeof result.current.stop).toBe('function');
        expect(typeof result.current.playTone).toBe('function');
    });

    it('sets playingId when playing a buffer', () => {
        const { ctx, source } = makeMockContext();
        mockGetAudioContext.mockReturnValue(ctx);
        const { result } = renderHook(() => usePreviewAudio());
        const buffer = { duration: 1 } as AudioBuffer;
        act(() => {
            result.current.play('sample-1', buffer);
        });
        expect(result.current.playingId).toBe('sample-1');
        expect(source.buffer).toBe(buffer);
    });

    it('clears playingId on stop', () => {
        const { ctx } = makeMockContext();
        mockGetAudioContext.mockReturnValue(ctx);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        expect(result.current.playingId).toBe('sample-1');
        act(() => {
            result.current.stop();
        });
        expect(result.current.playingId).toBeNull();
    });

    it('resumes the context if it is suspended', () => {
        const { ctx } = makeMockContext();
        ctx.state = 'suspended';
        mockGetAudioContext.mockReturnValue(ctx);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        expect(ctx.resume).toHaveBeenCalled();
    });

    it('plays a tone via oscillator', () => {
        const { ctx, oscillator } = makeMockContext();
        mockGetAudioContext.mockReturnValue(ctx);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.playTone('tone-1', 440, 0.5);
        });
        expect(result.current.playingId).toBe('tone-1');
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(oscillator.frequency.value).toBe(440);
        expect(oscillator.start).toHaveBeenCalled();
    });

    it('stops the previous source when playing a new one', () => {
        const { ctx, source } = makeMockContext();
        mockGetAudioContext.mockReturnValue(ctx);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        const firstSource = source;
        act(() => {
            result.current.play('sample-2', {} as AudioBuffer);
        });
        expect(firstSource.stop).toHaveBeenCalled();
        expect(firstSource.disconnect).toHaveBeenCalled();
    });
});
