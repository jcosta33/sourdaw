/**
 * Note Repeat — hold a pad to retrigger at a tempo-synced rate.
 * MPC-style performance feature. Rate adjustable in real-time.
 * Uses AudioContext clock correction (chained setTimeout) to prevent drift.
 */

import { inject } from '#/infra/di/inject';
import { getAudioTime } from '#/modules/AudioEngine';
import { triggerToasterPad } from './triggerPad';

type NoteRepeatState = {
    padIndex: number;
    velocity: number;
    timeoutId: ReturnType<typeof setTimeout>;
    nextTriggerTime: number;
    intervalSec: number;
};

let activeRepeat: NoteRepeatState | null = null;

export type NoteRepeatRate = '1/4' | '1/8' | '1/16' | '1/32' | '1/8t' | '1/16t';

function rateToDurationMs(rate: NoteRepeatRate, bpm: number): number {
    const beatMs = 60_000 / bpm;
    switch (rate) {
        case '1/4':
            return beatMs;
        case '1/8':
            return beatMs / 2;
        case '1/16':
            return beatMs / 4;
        case '1/32':
            return beatMs / 8;
        case '1/8t':
            return beatMs / 3;
        case '1/16t':
            return beatMs / 6;
    }
}

export function stopNoteRepeat(): void {
    if (activeRepeat) {
        clearTimeout(activeRepeat.timeoutId);
        activeRepeat = null;
    }
}

export const startNoteRepeatDependencies = {
    getAudioTime,
    triggerToasterPad,
} as const;

export const startNoteRepeat = inject(startNoteRepeatDependencies)(({ getAudioTime, triggerToasterPad }) => {
    function scheduleNextTrigger(): void {
        if (!activeRepeat) {
            return;
        }

        triggerToasterPad(activeRepeat.padIndex, activeRepeat.velocity);

        activeRepeat.nextTriggerTime += activeRepeat.intervalSec;
        const now = getAudioTime();
        const delayMs = Math.max(1, (activeRepeat.nextTriggerTime - now) * 1000);

        activeRepeat.timeoutId = setTimeout(scheduleNextTrigger, delayMs);
    }

    return function startNoteRepeat(
        padIndex: number,
        velocity: number,
        bpm: number,
        rate: NoteRepeatRate
    ): void {
        stopNoteRepeat();
        const durationMs = rateToDurationMs(rate, bpm);
        const intervalSec = durationMs / 1000;

        triggerToasterPad(padIndex, velocity);

        const nextTriggerTime = getAudioTime() + intervalSec;
        const delayMs = Math.max(1, intervalSec * 1000);
        const timeoutId = setTimeout(scheduleNextTrigger, delayMs);

        activeRepeat = { padIndex, velocity, timeoutId, nextTriggerTime, intervalSec };
    };
});

export function isNoteRepeating(): boolean {
    return activeRepeat !== null;
}

export const NOTE_REPEAT_RATES: NoteRepeatRate[] = ['1/4', '1/8', '1/16', '1/32', '1/8t', '1/16t'];
