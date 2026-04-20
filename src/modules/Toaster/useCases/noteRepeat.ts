/**
 * Note Repeat — hold a pad to retrigger at a tempo-synced rate.
 * MPC-style performance feature. Rate adjustable in real-time.
 * Uses AudioContext clock correction (chained setTimeout) to prevent drift.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { triggerToasterPad } from './triggerPad';

type NoteRepeatSession = {
    padIndex: number;
    velocity: number;
    timeoutId: ReturnType<typeof setTimeout>;
    nextTriggerTime: number;
    intervalSec: number;
};

let activeSession: NoteRepeatSession | null = null;

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
    if (activeSession) {
        clearTimeout(activeSession.timeoutId);
        activeSession = null;
    }
}

function scheduleNextTrigger(): void {
    if (!activeSession) {
        return;
    }

    triggerToasterPad(activeSession.padIndex, activeSession.velocity);

    activeSession.nextTriggerTime += activeSession.intervalSec;
    const now = getAudioTime();
    const delayMs = Math.max(1, (activeSession.nextTriggerTime - now) * 1000);

    activeSession.timeoutId = setTimeout(scheduleNextTrigger, delayMs);
}

export function startNoteRepeat(padIndex: number, velocity: number, bpm: number, rate: NoteRepeatRate): void {
    stopNoteRepeat();
    const durationMs = rateToDurationMs(rate, bpm);
    const intervalSec = durationMs / 1000;

    triggerToasterPad(padIndex, velocity);

    const nextTriggerTime = getAudioTime() + intervalSec;
    const delayMs = Math.max(1, intervalSec * 1000);
    const timeoutId = setTimeout(scheduleNextTrigger, delayMs);

    activeSession = { padIndex, velocity, timeoutId, nextTriggerTime, intervalSec };
}

export function isNoteRepeating(): boolean {
    return activeSession !== null;
}

export const NOTE_REPEAT_RATES: NoteRepeatRate[] = ['1/4', '1/8', '1/16', '1/32', '1/8t', '1/16t'];
