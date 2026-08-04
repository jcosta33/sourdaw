import { retrogradeMidiNotes } from '../../transformers/retrogradeMidiNotes';

import { applyMidiNoteTransform } from './applyMidiNoteTransform';

export function retrogradeNotes(clipId: string): boolean {
    return applyMidiNoteTransform({ clipId, transform: retrogradeMidiNotes });
}
