import { describe, expect, it, vi } from 'vitest';

import { clampClipFadeInDurationSeconds } from '#/utils/clipFadeScheduleClamp';

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
});
