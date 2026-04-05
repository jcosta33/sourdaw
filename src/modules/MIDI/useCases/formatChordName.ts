import { formatChordName as formatChordNameModel, type ChordEvent } from '../models/ChordEvent';

export function formatChordName(event: ChordEvent): string {
    return formatChordNameModel(event);
}
