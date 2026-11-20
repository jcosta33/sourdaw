import { type BriefReading } from '../../models/BriefReading';

/** The card lines for a request that reads more than one way. */
export function describeBriefReadings(readings: readonly BriefReading[]): string[] {
    return [
        'This request reads more than one way, so no batches are planned yet:',
        ...readings.map((reading) => `- ${reading.name}: ${reading.descriptors.join(', ')}`),
        'Confirm records the brief only. Choosing a reading runs the plan shown for it; a track measured silent after the choice is left out.',
    ];
}
