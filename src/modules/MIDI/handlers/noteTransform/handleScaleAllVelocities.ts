import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { scaleMidiVelocities } from '../../transformers/scaleMidiVelocities';
import { scaleAllVelocities } from '../../useCases/midiNoteTransforms/scaleAllVelocities';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareScaleAllVelocities(action: Extract<AppAction, { type: 'scaleAllVelocities' }>) {
    const label = `Scale velocities ×${action.payload.factor}`;
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label,
        transform: (notes) => scaleMidiVelocities({ notes, factor: action.payload.factor }),
    });
}

export const handleScaleAllVelocities = createHandler<'scaleAllVelocities'>({
    execute: (action) => {
        const written = scaleAllVelocities(action.payload.clipId, action.payload.factor);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareScaleAllVelocities(action).description,
    isNoop: (action) => prepareScaleAllVelocities(action).isNoop,
    undoable: true,
});
