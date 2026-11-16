import { type BriefReading } from '../../models/BriefReading';

export function describeChosenBriefReading(reading: BriefReading): string {
    return `Reading chosen: ${reading.name} (${reading.descriptors.join(', ')}).`;
}
