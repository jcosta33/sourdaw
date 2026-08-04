import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { setMidiVelocities } from '../../transformers/setMidiVelocities';
import { setAllVelocities } from '../../useCases/midiNoteTransforms/setAllVelocities';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareSetAllVelocities(action: Extract<AppAction, { type: 'setAllVelocities' }>) {
    const label = `Set all velocities to ${action.payload.velocity}`;
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label,
        transform: (notes) => setMidiVelocities({ notes, velocity: action.payload.velocity }),
    });
}

export const handleSetAllVelocities = createHandler<'setAllVelocities'>({
    execute: (action) => {
        const written = setAllVelocities(action.payload.clipId, action.payload.velocity);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareSetAllVelocities(action).description,
    isNoop: (action) => prepareSetAllVelocities(action).isNoop,
    undoable: true,
});
