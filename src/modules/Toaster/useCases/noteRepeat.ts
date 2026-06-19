/**
 * Note Repeat — hold a pad to retrigger at a tempo-synced rate.
 * MPC-style performance feature. Rate adjustable in real-time.
 * Uses AudioContext clock correction (chained setTimeout) to prevent drift.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { triggerToasterPad } from './triggerPad';

type NoteRepeatSession = {
    deviceId: string;
    padIndex: number;
    velocity: number;
    timeoutId: ReturnType<typeof setTimeout>;
    nextTriggerTime: number;
    intervalSec: number;
};

// Keyed by deviceId so two Toaster instances can each hold an independent
// note-repeat without one stealing or stopping the other's session.
const activeSessions = new Map<string, NoteRepeatSession>();

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
        default:
            throw new Error(`Unknown note repeat rate: ${rate}`);
    }
}

export function stopNoteRepeat(deviceId: string): void {
    const session = activeSessions.get(deviceId);
    if (session) {
        clearTimeout(session.timeoutId);
        activeSessions.delete(deviceId);
    }
}

// If the timer wakes more than this many intervals late (e.g. the tab was
// suspended in the background), don't try to replay every missed trigger —
// that burns CPU firing a burst of catch-up hits. Resync to "now" instead.
const MAX_CATCHUP_INTERVALS = 2;

function scheduleNextTrigger(deviceId: string): void {
    const session = activeSessions.get(deviceId);
    if (!session) {
        return;
    }

    triggerToasterPad(session.deviceId, session.padIndex, session.velocity);

    const now = getAudioTime();
    session.nextTriggerTime += session.intervalSec;

    // Clamp catch-up: if we fell far behind (tab-suspend), reset the schedule
    // to one interval from now rather than firing repeatedly to catch up.
    if (now - session.nextTriggerTime > MAX_CATCHUP_INTERVALS * session.intervalSec) {
        session.nextTriggerTime = now + session.intervalSec;
    }

    const delayMs = Math.max(1, (session.nextTriggerTime - now) * 1000);

    session.timeoutId = setTimeout(() => scheduleNextTrigger(deviceId), delayMs);
}

export function startNoteRepeat(
    deviceId: string,
    padIndex: number,
    velocity: number,
    bpm: number,
    rate: NoteRepeatRate
): void {
    stopNoteRepeat(deviceId);
    const durationMs = rateToDurationMs(rate, bpm);
    const intervalSec = durationMs / 1000;

    triggerToasterPad(deviceId, padIndex, velocity);

    const nextTriggerTime = getAudioTime() + intervalSec;
    const delayMs = Math.max(1, intervalSec * 1000);
    const timeoutId = setTimeout(() => scheduleNextTrigger(deviceId), delayMs);

    activeSessions.set(deviceId, { deviceId, padIndex, velocity, timeoutId, nextTriggerTime, intervalSec });
}

export function isNoteRepeating(deviceId: string): boolean {
    return activeSessions.has(deviceId);
}

export const NOTE_REPEAT_RATES: NoteRepeatRate[] = ['1/4', '1/8', '1/16', '1/32', '1/8t', '1/16t'];
