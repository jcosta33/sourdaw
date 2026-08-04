import { invertMidiNotes } from '../../transformers/invertMidiNotes';

import { applyMidiNoteTransform } from './applyMidiNoteTransform';

export function invertNotes(clipId: string): boolean {
    return applyMidiNoteTransform({ clipId, transform: invertMidiNotes });
}
