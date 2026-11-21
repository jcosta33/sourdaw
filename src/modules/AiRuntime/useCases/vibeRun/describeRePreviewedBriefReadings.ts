import { type BriefReading } from '../../models/BriefReading';

import { describeBriefReadings } from './describeBriefReadings';

/**
 * The readings lines on a re-previewed card, which keeps no offered readings (they stay bound to the
 * original revision's goals) and so promises no choice: the same listing, with a closing sentence that offers none.
 */
export function describeRePreviewedBriefReadings(readings: readonly BriefReading[]): string[] {
    return [
        ...describeBriefReadings(readings).slice(0, -1),
        'Confirm records the brief only. Re-preview offers no reading to choose; ask again to plan one.',
    ];
}
