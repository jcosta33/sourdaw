import { readSecondsAtBeat } from '#/modules/Transport/stores';

/** Seconds an offline render processes to reach this beat: renders start at beat 0 whatever the range's start. */
export function readMeasurementRenderedSeconds(endBeat: number): number {
    return readSecondsAtBeat({ beat: endBeat }) - readSecondsAtBeat({ beat: 0 });
}
