import { type BriefMixAlternative, type BriefReading } from '../../models/BriefReading';

/** Each reading's id is its position on the card, which is stable for as long as the card lives. */
export function buildBriefReadings(alternatives: readonly BriefMixAlternative[]): BriefReading[] {
    return alternatives.map((alternative, index) => ({
        id: `reading-${String(index + 1)}`,
        name: alternative.name,
        descriptors: [...alternative.requestedDescriptors],
    }));
}
