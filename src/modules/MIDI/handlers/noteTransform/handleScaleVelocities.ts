import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNote';
import { mapMidiVelocitiesByCurve } from '../../transformers/mapMidiVelocitiesByCurve';
import { scaleVelocities } from '../../useCases/midiNoteTransforms/scaleVelocities';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

import { isMidiNoteTransformSessionEntry } from './isMidiNoteTransformSessionEntry';
import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

type ScaleVelocitiesAction = Extract<AppAction, { type: 'scaleVelocities' }>;

function transformNotes(action: ScaleVelocitiesAction, notes: readonly MidiNote[]): MidiNote[] {
    const { curve, minVelocity = 1, maxVelocity = 127 } = action.payload;
    return mapMidiVelocitiesByCurve({ notes, curve, minVelocity, maxVelocity });
}

function findVelocityRangeRefusal(action: ScaleVelocitiesAction): string | null {
    const { minVelocity = 1, maxVelocity = 127 } = action.payload;
    return minVelocity > maxVelocity ? `minVelocity ${minVelocity} must not exceed maxVelocity ${maxVelocity}` : null;
}

function findScaleVelocitiesRefusal(action: ScaleVelocitiesAction, context?: HandlerValidationContext): string | null {
    const rangeRefusal = findVelocityRangeRefusal(action);
    if (rangeRefusal !== null) {
        return rangeRefusal;
    }
    return getWritableMidiClipReplayGuardForBatch(action.payload.clipId, context) === null
        ? `Clip "${action.payload.clipId}" is not a writable MIDI clip`
        : null;
}

function prepareScaleVelocities(action: ScaleVelocitiesAction, context?: HandlerValidationContext) {
    return prepareMidiNoteTransformUndo({
        context,
        clipId: action.payload.clipId,
        label: `Scale velocities (${action.payload.curve})`,
        transform: (notes) => transformNotes(action, notes),
    });
}

export const handleScaleVelocities = createHandler<'scaleVelocities'>({
    execute: (action) => {
        if (
            findVelocityRangeRefusal(action) !== null ||
            !getWritableMidiClipReplayGuardForBatch(action.payload.clipId)
        ) {
            return { status: 'conflict' };
        }
        const written = scaleVelocities(
            action.payload.clipId,
            action.payload.curve,
            action.payload.minVelocity,
            action.payload.maxVelocity
        );
        return { status: written ? 'written' : 'no-write' };
    },
    validate: (action, context) => findScaleVelocitiesRefusal(action, context) === null,
    validationRefusalReason: findScaleVelocitiesRefusal,
    describe: (action, context) => prepareScaleVelocities(action, context).description,
    isNoop: (action) => prepareScaleVelocities(action).isNoop,
    validateSessionEntry: (entry) => {
        const { action } = entry;
        if (action.type !== 'scaleVelocities') {
            return false;
        }
        return isMidiNoteTransformSessionEntry({
            entry,
            clipId: action.payload.clipId,
            transform: (notes) => transformNotes(action, notes),
        });
    },
    undoable: true,
});
