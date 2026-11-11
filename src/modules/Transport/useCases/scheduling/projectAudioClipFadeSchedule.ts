import {
    MICRO_FADE_SECONDS,
    clampClipFadeInDurationSeconds,
    clampClipFadeOutStartSeconds,
} from '#/utils/clipFadeScheduleClamp';

type Segment = {
    soundStartTime: number;
    playDuration: number;
    audibleStartTime: number;
    preRollSeconds: number;
};
type FadeEvent = { kind: 'set' | 'linear'; gain: number; time: number };
type FadeInput = {
    first: Segment;
    last: Segment;
    now: number;
    clipGain: number;
    fadeInEndTime: number | null;
    fadeOut: { endTime: number; duration: number } | null;
    microFadeIn: boolean;
    microFadeOut: boolean;
};

function attackEvents(input: FadeInput, effectiveStart: number): FadeEvent[] {
    const { first, clipGain, fadeInEndTime } = input;
    if (fadeInEndTime !== null) {
        const duration = clampClipFadeInDurationSeconds(fadeInEndTime - first.soundStartTime, first.playDuration);
        const end = first.soundStartTime + duration;
        if (effectiveStart < end) {
            const progress = Math.max(0, effectiveStart - first.soundStartTime) / duration;
            return [
                { kind: 'set', gain: progress * clipGain, time: effectiveStart },
                { kind: 'linear', gain: clipGain, time: end },
            ];
        }
        if (first.preRollSeconds === 0) {
            return [{ kind: 'set', gain: clipGain, time: effectiveStart }];
        }
    } else if (!input.microFadeIn) {
        return [{ kind: 'set', gain: clipGain, time: effectiveStart }];
    }
    return [
        { kind: 'set', gain: 0, time: effectiveStart },
        { kind: 'linear', gain: clipGain, time: effectiveStart + MICRO_FADE_SECONDS },
    ];
}

function releaseEvents(input: FadeInput, effectiveStart: number): FadeEvent[] {
    const { last, clipGain, fadeOut } = input;
    if (fadeOut) {
        const start = clampClipFadeOutStartSeconds(
            fadeOut.endTime - fadeOut.duration,
            last.soundStartTime,
            last.playDuration
        );
        return [
            { kind: 'set', gain: clipGain, time: Math.max(start, effectiveStart) },
            { kind: 'linear', gain: 0, time: fadeOut.endTime },
        ];
    }
    if (!input.microFadeOut) {
        return [];
    }
    const end = last.soundStartTime + last.playDuration;
    return [
        { kind: 'set', gain: clipGain, time: Math.max(effectiveStart, end - MICRO_FADE_SECONDS) },
        { kind: 'linear', gain: 0, time: end },
    ];
}

/** One ordered fade law supplies both its pre-event seed and its later automation. */
export function projectAudioClipFadeSchedule(input: FadeInput) {
    const effectiveStart = Math.max(input.first.audibleStartTime, input.now);
    const events = [...attackEvents(input, effectiveStart), ...releaseEvents(input, effectiveStart)];
    let initialGain = events[0]!.gain;
    // A later plateau at the same instant replaces the attack, including on
    // legal sub-microfade durations. Seeding only the first call would mute it.
    for (const event of events) {
        if (event.time <= effectiveStart) {
            initialGain = event.gain;
        }
    }
    return { initialGain, events };
}
