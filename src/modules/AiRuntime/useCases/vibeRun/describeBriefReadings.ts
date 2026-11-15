import { type BriefMixAlternative, type BriefReading } from '../../models/BriefReading';

/** Each reading's id is its position on the card, which is stable for as long as the card lives. */
export function buildBriefReadings(alternatives: readonly BriefMixAlternative[]): BriefReading[] {
    return alternatives.map((alternative, index) => ({
        id: `reading-${String(index + 1)}`,
        name: alternative.name,
        descriptors: [...alternative.requestedDescriptors],
    }));
}

/** The card lines for a request that reads more than one way. */
export function describeBriefReadings(readings: readonly BriefReading[]): string[] {
    return [
        'This request reads more than one way, so no batches are planned yet:',
        ...readings.map((reading) => `- ${reading.name}: ${reading.descriptors.join(', ')}`),
        'Confirm records the brief only. Choosing a reading plans the batches for exactly that reading.',
    ];
}

export function describeChosenBriefReading(reading: BriefReading): string {
    return `Reading chosen: ${reading.name} (${reading.descriptors.join(', ')}).`;
}
