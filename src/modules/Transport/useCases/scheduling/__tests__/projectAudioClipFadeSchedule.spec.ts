import { describe, expect, it } from 'vitest';

import { projectAudioClipFadeSchedule } from '../projectAudioClipFadeSchedule';

const first = { soundStartTime: 4, audibleStartTime: 4, playDuration: 2, preRollSeconds: 0 };
const programme = {
    first,
    last: first,
    now: 0,
    clipGain: 0.25,
    fadeInEndTime: null,
    fadeOut: null,
    microFadeIn: true,
    microFadeOut: true,
};

describe('projectAudioClipFadeSchedule', () => {
    it('uses one ordered programme for the zero attack and its gained release', () => {
        expect(projectAudioClipFadeSchedule(programme)).toEqual({
            initialGain: 0,
            events: [
                { kind: 'set', gain: 0, time: 4 },
                { kind: 'linear', gain: 0.25, time: 4.003 },
                { kind: 'set', gain: 0.25, time: 5.997 },
                { kind: 'linear', gain: 0, time: 6 },
            ],
        });
    });

    it('retains drawn progress and a drawn outgoing span', () => {
        expect(
            projectAudioClipFadeSchedule({
                ...programme,
                now: 4.5,
                fadeInEndTime: 5,
                fadeOut: { endTime: 6, duration: 0.5 },
            })
        ).toEqual({
            initialGain: 0.125,
            events: [
                { kind: 'set', gain: 0.125, time: 4.5 },
                { kind: 'linear', gain: 0.25, time: 5 },
                { kind: 'set', gain: 0.25, time: 5.5 },
                { kind: 'linear', gain: 0, time: 6 },
            ],
        });
    });

    it('keeps the plateau after an elapsed drawn attack without preroll', () => {
        const result = projectAudioClipFadeSchedule({ ...programme, now: 5.5, fadeInEndTime: 5 });
        expect(result.initialGain).toBe(0.25);
        expect(result.events[0]).toEqual({ kind: 'set', gain: 0.25, time: 5.5 });
    });

    it('micro-fades a drawn attack elapsed inside negative-entry preroll', () => {
        const result = projectAudioClipFadeSchedule({
            ...programme,
            first: { ...first, soundStartTime: 5, preRollSeconds: 1 },
            now: 5.5,
            fadeInEndTime: 4.5,
        });
        expect(result.initialGain).toBe(0);
        expect(result.events.slice(0, 2)).toEqual([
            { kind: 'set', gain: 0, time: 5.5 },
            { kind: 'linear', gain: 0.25, time: 5.503 },
        ]);
    });

    it('preserves the nonzero initial level on an interior clip-loop pass', () => {
        expect(projectAudioClipFadeSchedule({ ...programme, microFadeIn: false, microFadeOut: false })).toEqual({
            initialGain: 0.25,
            events: [{ kind: 'set', gain: 0.25, time: 4 }],
        });
    });

    it('lets the later equal-time plateau win for a legal two millisecond source', () => {
        const segment = { ...first, playDuration: 0.002 };
        expect(projectAudioClipFadeSchedule({ ...programme, first: segment, last: segment })).toEqual({
            initialGain: 0.25,
            events: [
                { kind: 'set', gain: 0, time: 4 },
                { kind: 'linear', gain: 0.25, time: 4.003 },
                { kind: 'set', gain: 0.25, time: 4 },
                { kind: 'linear', gain: 0, time: 4.002 },
            ],
        });
    });

    it('keeps the same-time outgoing plateau on a late final two millisecond join', () => {
        const result = projectAudioClipFadeSchedule({ ...programme, now: 5.998 });
        expect(result.initialGain).toBe(0.25);
        expect(result.events[2]).toEqual({ kind: 'set', gain: 0.25, time: 5.998 });
    });

    it('spans both shared source segments without restarting the attack', () => {
        const result = projectAudioClipFadeSchedule({ ...programme, last: { ...first, soundStartTime: 6 } });
        expect(result.events).toEqual([
            { kind: 'set', gain: 0, time: 4 },
            { kind: 'linear', gain: 0.25, time: 4.003 },
            { kind: 'set', gain: 0.25, time: 7.997 },
            { kind: 'linear', gain: 0, time: 8 },
        ]);
    });
});
