import { scaleMidiVelocities } from '../../transformers/scaleMidiVelocities';

import { applyMidiNoteTransform } from './applyMidiNoteTransform';

export function scaleAllVelocities(clipId: string, factor: number): boolean {
    return applyMidiNoteTransform({
        clipId,
        transform: (notes) => scaleMidiVelocities({ notes, factor }),
    });
}
