/**
 * How the native export gets its automation writes (#2225), part two: the
 * conversion from what `createAutomationRecorder` captured into the
 * contract's write shapes.
 *
 *   - `set`    → `step` — both take the value at the stated time with no glide.
 *   - `linear` → `ramp-to`, anchored one frame after the previous event. The
 *     native ramp is a cancel-and-replace (`AutomationWrite::Replace` drops
 *     queued events at or after `startTime`), so anchoring *at* the previous
 *     event's time would cancel that event; one frame later it survives, and
 *     the ramp departs from the value it landed. The cost is a ramp that
 *     starts one frame late — a deviation bounded by `slope / sampleRate`,
 *     which the export-parity spec measures against its residual floor.
 *
 * Values are converted from the node domain the scheduler wrote (the fader
 * law and VCA fold already applied) back into the seam's project units via
 * `valueToSeam`, because the contract's targets state project truth and the
 * backend applies the law itself. The caller owns that inversion — see the
 * seam-value helpers in `renderOfflineWithNativeEngine`.
 */

import { type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';

import { type RecordedAutomationEvent } from './createAutomationRecorder';

export type RecordedWriteConversion =
    | Readonly<{ outcome: 'converted'; writes: readonly AudioGraphParameterWrite[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

export type ConvertRecordedEventsInput = Readonly<{
    events: readonly RecordedAutomationEvent[];
    sampleRate: number;
    /** Node-domain value back into the seam's project units. */
    valueToSeam: (value: number) => number;
}>;

/** Recorded param calls into the contract's write shapes. See the header. */
export function convertRecordedAutomationEvents(input: ConvertRecordedEventsInput): RecordedWriteConversion {
    const { events, sampleRate, valueToSeam } = input;
    const frameSeconds = 1 / sampleRate;
    const writes: AudioGraphParameterWrite[] = [];
    let previousTime = Number.NEGATIVE_INFINITY;
    let anchored = false;

    for (const event of events) {
        if (event.timeSeconds < previousTime) {
            return {
                outcome: 'declined',
                reason: `automation events arrived out of order (${String(event.timeSeconds)}s after ${String(previousTime)}s)`,
            };
        }
        if (event.kind === 'set') {
            writes.push({ shape: 'step', value: valueToSeam(event.value), time: event.timeSeconds });
            anchored = true;
        } else {
            if (!anchored) {
                return { outcome: 'declined', reason: 'a ramp arrived with no anchoring value before it' };
            }
            const startTime = previousTime + frameSeconds;
            if (event.timeSeconds <= startTime) {
                // A ramp landing within one frame of its anchor has no span to
                // glide over; both runtimes realize it as the value at the
                // landing frame.
                writes.push({ shape: 'step', value: valueToSeam(event.value), time: event.timeSeconds });
            } else {
                writes.push({
                    shape: 'ramp-to',
                    value: valueToSeam(event.value),
                    startTime,
                    landTime: event.timeSeconds,
                });
            }
        }
        previousTime = event.timeSeconds;
    }
    return { outcome: 'converted', writes };
}
