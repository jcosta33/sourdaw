import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { pausePlayback } from '../pausePlayback';
import { setPlayback } from '../setPlayback';
import { startPlayback } from '../startPlayback';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../pausePlayback', () => ({ pausePlayback: vi.fn() }));
vi.mock('../startPlayback', () => ({ startPlayback: vi.fn() }));
const previewIntents = vi.hoisted(() => {
    let exclusive: AbortController | null = null;
    let ordinarySignal: AbortSignal | null = null;
    return {
        get ordinarySignal() {
            return ordinarySignal;
        },
        beginExclusive() {
            const controller = new AbortController();
            exclusive = controller;
            return {
                signal: controller.signal,
                release: () => controller.abort('released'),
            };
        },
        beginOrdinary() {
            const previous = exclusive;
            exclusive = null;
            previous?.abort('preempted');
            const controller = new AbortController();
            ordinarySignal = controller.signal;
            return {
                signal: controller.signal,
                release: () => controller.abort('released'),
            };
        },
        reset() {
            exclusive?.abort('reset');
            exclusive = null;
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        beginAudioPreviewIntent: previewIntents.beginOrdinary,
        beginExclusiveAudioPreviewIntent: previewIntents.beginExclusive,
    },
}));

describe('setPlayback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        previewIntents.reset();
    });

    it('starts playback only when the desired state is playing', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false });

        setPlayback(true);

        expect(startPlayback).toHaveBeenCalledOnce();
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('pauses playback only when the desired state is paused', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });

        setPlayback(false);

        expect(pausePlayback).toHaveBeenCalledOnce();
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it.each([true, false])('does not toggle when playback already equals %s', (playing) => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: playing });

        setPlayback(playing);

        expect(startPlayback).not.toHaveBeenCalled();
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('does nothing when transport state is unavailable', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        setPlayback(true);

        expect(startPlayback).not.toHaveBeenCalled();
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('retires an exclusive preview before reading state and dispatching Play', () => {
        const events: string[] = [];
        const exclusive = previewIntents.beginExclusive();
        exclusive.signal.addEventListener('abort', () => events.push('preview-abort'));
        vi.mocked(getTransportState).mockImplementation(() => {
            expect(previewIntents.ordinarySignal?.aborted).toBe(true);
            events.push('transport-read');
            return { ...defaultTransportState, isPlaying: false };
        });
        vi.mocked(startPlayback).mockImplementation(async () => {
            events.push('play-dispatched');
        });

        setPlayback(true);

        expect(exclusive.signal.aborted).toBe(true);
        expect(events).toEqual(['preview-abort', 'transport-read', 'play-dispatched']);
    });
});
