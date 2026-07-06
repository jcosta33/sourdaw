import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { NOTE_REPEAT_RATE_BEAT_FACTORS, type NoteRepeatRate } from './noteRepeat';
import { activeNoteRepeatSessions, MAX_NOTE_REPEAT_CATCHUP_INTERVALS } from './noteRepeatState';
import { stopNoteRepeat } from './stopNoteRepeat';
import { triggerToasterPad } from './triggerPad';

function rateToDurationMs(rate: NoteRepeatRate, bpm: number): number {
    return (60_000 / bpm) * NOTE_REPEAT_RATE_BEAT_FACTORS[rate];
}

function scheduleNextTrigger(deviceId: string): void {
    const session = activeNoteRepeatSessions.get(deviceId);
    if (!session) {
        return;
    }

    triggerToasterPad(session.deviceId, session.padIndex, session.velocity);

    const now = getAudioTime();
    session.nextTriggerTime += session.intervalSec;

    // Clamp catch-up: if we fell far behind (tab-suspend), reset the schedule
    // to one interval from now rather than firing repeatedly to catch up.
    if (now - session.nextTriggerTime > MAX_NOTE_REPEAT_CATCHUP_INTERVALS * session.intervalSec) {
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

    activeNoteRepeatSessions.set(deviceId, { deviceId, padIndex, velocity, timeoutId, nextTriggerTime, intervalSec });
}
