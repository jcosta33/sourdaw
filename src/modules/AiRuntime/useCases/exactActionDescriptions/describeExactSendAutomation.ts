import { type AppAction } from '#/utils/handlerContract';

import { formatDecibelsFromGain } from './formatDecibelsFromGain';

/** The tail send automation in words, or `null` until its ranges and tracks are materialized. */
export function describeExactSendAutomation(action: Extract<AppAction, { type: 'automateSendRanges' }>): string | null {
    if (!action.payload.ranges || !action.payload.expectedTracks) {
        return null;
    }
    const targets = action.payload.expectedTracks
        .map(
            (track) =>
                `"${track.trackName}" (${track.trackId}) ${formatDecibelsFromGain(track.sendLevel)}→${String(action.payload.targetLevelDb)} dB`
        )
        .join(', ');
    const ranges = action.payload.ranges
        .map(
            (range) =>
                `"${range.sectionName}" (${range.sectionId}) ramp beats ${String(range.automationStartBeat)}–${String(range.endBeat)}`
        )
        .join(', ');
    return `Automate sends to "${action.payload.busName ?? action.payload.busId}" (${action.payload.busId}) over the final ${String(action.payload.tailBars)} bars: ${targets}; ${ranges}; restore base levels at each section end`;
}
