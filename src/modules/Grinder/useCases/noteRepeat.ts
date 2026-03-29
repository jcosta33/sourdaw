/**
 * Note Repeat — hold a pad to retrigger at a tempo-synced rate.
 * MPC-style performance feature. Rate adjustable in real-time.
 */

import { triggerGrinderPad } from './triggerPad';

type NoteRepeatState = {
    padIndex: number;
    velocity: number;
    intervalId: ReturnType<typeof setInterval>;
};

let activeRepeat: NoteRepeatState | null = null;

type NoteRepeatRate = '1/4' | '1/8' | '1/16' | '1/32' | '1/8t' | '1/16t';

function rateToDurationMs(rate: NoteRepeatRate, bpm: number): number {
    const beatMs = 60_000 / bpm;
    switch (rate) {
        case '1/4': return beatMs;
        case '1/8': return beatMs / 2;
        case '1/16': return beatMs / 4;
        case '1/32': return beatMs / 8;
        case '1/8t': return beatMs / 3;
        case '1/16t': return beatMs / 6;
    }
}

export function startNoteRepeat(padIndex: number, velocity: number, bpm: number, rate: NoteRepeatRate): void {
    stopNoteRepeat();
    const durationMs = rateToDurationMs(rate, bpm);

    // Trigger immediately
    triggerGrinderPad(padIndex, velocity);

    const intervalId = setInterval(() => {
        triggerGrinderPad(padIndex, velocity);
    }, durationMs);

    activeRepeat = { padIndex, velocity, intervalId };
}

export function stopNoteRepeat(): void {
    if (activeRepeat) {
        clearInterval(activeRepeat.intervalId);
        activeRepeat = null;
    }
}

export function isNoteRepeating(): boolean {
    return activeRepeat !== null;
}

export const NOTE_REPEAT_RATES: NoteRepeatRate[] = ['1/4', '1/8', '1/16', '1/32', '1/8t', '1/16t'];
