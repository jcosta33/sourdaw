import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startClipAudition, useClipAudition } from '../useClipAudition';

const fixture = vi.hoisted(() => ({
    engine: null as typeof import('#/modules/AudioEngine/useCases').audioEngine | null,
    restoration: undefined as Promise<void> | undefined,
    play: vi.fn(),
    stopNote: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    fixture.engine = actual.audioEngine;
    return {
        playAuditionNote: fixture.play,
        audioEngine: {
            beginAudioPreviewIntent: () => {
                if (fixture.engine === null) {
                    throw new Error('Missing real clip intent registry.');
                }
                const intent = fixture.engine.beginAudioPreviewIntent();
                return fixture.restoration === undefined ? intent : { ...intent, ready: fixture.restoration };
            },
        },
    };
});
vi.mock('#/modules/Arrangement/useCases', () => ({ getTrackStoreState: () => ({ tracks: [{ id: 'track' }] }) }));
vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: () => [
        { id: 'a', pitch: 60, velocity: 100, startBeat: 0, duration: 1 },
        { id: 'b', pitch: 64, velocity: 80, startBeat: 2, duration: 1 },
    ],
}));
vi.mock('#/modules/Transport/useCases', () => ({ getTransportState: () => ({ tempo: 120 }) }));

describe('committed clip ordinary group lifetime', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        fixture.engine?.resetGraph();
        fixture.restoration = undefined;
        fixture.play.mockReturnValue(fixture.stopNote);
    });
    afterEach(() => {
        cleanup();
        fixture.engine?.resetGraph();
        vi.useRealTimers();
    });

    it('passes one current group through both relative note times without ordinary global preemption', () => {
        const stop = startClipAudition({ clipId: 'clip', trackId: 'track' }, vi.fn());
        expect(stop).not.toBeNull();
        vi.advanceTimersByTime(0);
        const group = fixture.play.mock.calls[0]?.[3];
        expect(group?.isCurrent()).toBe(true);
        expect(fixture.play).toHaveBeenNthCalledWith(1, 'track', 60, 100, group);
        vi.advanceTimersByTime(500);
        expect(fixture.stopNote).toHaveBeenCalledTimes(1);
        expect(group?.isCurrent()).toBe(true);
        vi.advanceTimersByTime(500);
        expect(fixture.play).toHaveBeenNthCalledWith(2, 'track', 64, 80, group);
        stop?.();
        expect(group?.isCurrent()).toBe(false);
    });

    it('a newer exclusive intent cancels armed child timers and only this group notes', () => {
        const ended = vi.fn();
        startClipAudition({ clipId: 'clip', trackId: 'track' }, ended);
        vi.advanceTimersByTime(0);
        const exclusive = fixture.engine?.beginExclusiveAudioPreviewIntent();
        expect(exclusive?.isCurrent()).toBe(true);
        expect(fixture.stopNote).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2_000);
        expect(fixture.play).toHaveBeenCalledTimes(1);
        expect(ended).toHaveBeenCalledTimes(1);
        expect(exclusive?.isCurrent()).toBe(true);
    });

    it('Stop while restoration is pending prevents all later note dispatch', async () => {
        const restore = Promise.withResolvers<void>();
        fixture.restoration = restore.promise;
        const stop = startClipAudition({ clipId: 'clip', trackId: 'track' }, vi.fn());
        stop?.();
        restore.resolve();
        await restore.promise;
        vi.advanceTimersByTime(2_000);
        expect(fixture.play).not.toHaveBeenCalled();
    });

    it('the real hook releases its current group on unmount', () => {
        const hook = renderHook(() => useClipAudition());
        act(() => hook.result.current.toggleAudition({ clipId: 'clip', trackId: 'track' }));
        act(() => vi.advanceTimersByTime(0));
        const group = fixture.play.mock.calls[0]?.[3];
        hook.unmount();
        expect(group?.isCurrent()).toBe(false);
        expect(fixture.stopNote).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2_000);
        expect(fixture.play).toHaveBeenCalledTimes(1);
    });
});
