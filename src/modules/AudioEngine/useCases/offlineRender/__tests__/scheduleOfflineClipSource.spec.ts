import { describe, expect, it, vi } from 'vitest';

import { clampClipFadeInDurationSeconds, clampClipFadeOutStartSeconds } from '#/utils/clipFadeScheduleClamp';

import { scheduleOfflineClipSource } from '../scheduleOfflineClipSource';

type FakeGain = {
    gain: {
        setValueAtTime: ReturnType<typeof vi.fn>;
        linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
};

function makeRecordingContext(): { context: BaseAudioContext; gains: FakeGain[] } {
    const gains: FakeGain[] = [];
    const context = {
        createBufferSource: vi.fn(() => ({
            buffer: null,
            playbackRate: { value: 1 },
            connect: vi.fn(),
            start: vi.fn(),
        })),
        createGain: vi.fn(() => {
            const gain: FakeGain = {
                gain: {
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn(),
                },
                connect: vi.fn(),
            };
            gains.push(gain);
            return gain;
        }),
    } as unknown as BaseAudioContext;
    return { context, gains };
}

describe('scheduleOfflineClipSource — shared half-duration fade clamp', () => {
    /// Companion to Transport `scheduleAudioClips` "#2867": the same 2-beat
    /// clip with a 1.6-beat fade-in, driven through the offline scheduler.
    /// Live and offline must land the plateau at this same instant.
    it('reaches the fade-in plateau at the same instant live does when the fade exceeds half the clip', () => {
        const { context, gains } = makeRecordingContext();
        const startSec = 4;
        const playDuration = 1;
        const requestedFadeInSeconds = 1.6 / 2;
        const microFadeSeconds = 0.003;

        scheduleOfflineClipSource({
            context,
            destinationNode: { connect: vi.fn() } as unknown as AudioNode,
            buffer: { duration: 100 } as AudioBuffer,
            startSec,
            bufferOffsetSec: 0,
            playDuration,
            playbackRate: 1,
            clipGainValue: 1,
            fadeIn: { userEndSec: startSec + requestedFadeInSeconds },
            microFadeSeconds,
        });

        const plateauSeconds =
            startSec + clampClipFadeInDurationSeconds(requestedFadeInSeconds, playDuration, microFadeSeconds);
        expect(plateauSeconds).toBe(startSec + playDuration * 0.5);
        expect(gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(0, startSec);
        expect(gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, plateauSeconds);
        expect(gains[0]!.gain.linearRampToValueAtTime).not.toHaveBeenCalledWith(1, startSec + requestedFadeInSeconds);
    });

    /// Companion to Transport `scheduleAudioClips` fade-out "#2867": the
    /// same 2-beat clip with a 1.6-beat fade-out. Unhooking
    /// `clampClipFadeOutStartSeconds` starts the ramp at 4.2 s, the
    /// unclamped earlier instant, instead of holding the plateau to 4.5 s.
    it('holds the fade-out plateau until the midpoint when the fade-out exceeds half the clip', () => {
        const { context, gains } = makeRecordingContext();
        const startSec = 4;
        const playDuration = 1;
        const unclampedFadeOutStartSeconds = startSec + 0.2;
        const microFadeSeconds = 0.003;

        scheduleOfflineClipSource({
            context,
            destinationNode: { connect: vi.fn() } as unknown as AudioNode,
            buffer: { duration: 100 } as AudioBuffer,
            startSec,
            bufferOffsetSec: 0,
            playDuration,
            playbackRate: 1,
            clipGainValue: 1,
            fadeOut: { userStartSec: unclampedFadeOutStartSeconds },
            microFadeSeconds,
        });

        const clampedFadeOutStartSeconds = clampClipFadeOutStartSeconds(
            unclampedFadeOutStartSeconds,
            startSec,
            playDuration
        );
        expect(clampedFadeOutStartSeconds).toBe(startSec + playDuration * 0.5);
        expect(gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(1, clampedFadeOutStartSeconds);
        expect(gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, startSec + playDuration);
        expect(gains[0]!.gain.setValueAtTime).not.toHaveBeenCalledWith(1, unclampedFadeOutStartSeconds);
    });
});
