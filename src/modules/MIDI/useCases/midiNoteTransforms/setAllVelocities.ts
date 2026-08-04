import { setMidiVelocities } from '../../transformers/setMidiVelocities';

import { applyMidiNoteTransform } from './applyMidiNoteTransform';

export function setAllVelocities(clipId: string, velocity: number): boolean {
    return applyMidiNoteTransform({
        clipId,
        transform: (notes) => setMidiVelocities({ notes, velocity }),
    });
}
