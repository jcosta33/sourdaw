import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';

import { handleHumanizeNotes } from '../handlers/noteTransform/handleHumanizeNotes';
import { handleInvertNotes } from '../handlers/noteTransform/handleInvertNotes';
import { handleQuantizeNoteLengths } from '../handlers/noteTransform/handleQuantizeNoteLengths';
import { handleQuantizeNotes } from '../handlers/noteTransform/handleQuantizeNotes';
import { handleRetrogradeNotes } from '../handlers/noteTransform/handleRetrogradeNotes';
import { handleScaleAllVelocities } from '../handlers/noteTransform/handleScaleAllVelocities';
import { handleScaleVelocities } from '../handlers/noteTransform/handleScaleVelocities';
import { handleSetAllVelocities } from '../handlers/noteTransform/handleSetAllVelocities';
import { handleTransposeNotes } from '../handlers/noteTransform/handleTransposeNotes';

type MidiNoteTransformAppAction =
    | Extract<AppAction, { type: 'humanizeNotes' }>
    | Extract<AppAction, { type: 'invertNotes' }>
    | Extract<AppAction, { type: 'quantizeNoteLengths' }>
    | Extract<AppAction, { type: 'quantizeNotes' }>
    | Extract<AppAction, { type: 'retrogradeNotes' }>
    | Extract<AppAction, { type: 'scaleAllVelocities' }>
    | Extract<AppAction, { type: 'scaleVelocities' }>
    | Extract<AppAction, { type: 'setAllVelocities' }>
    | Extract<AppAction, { type: 'transposeNotes' }>;

export type MidiNoteTransformHandlersMap = {
    [Action in MidiNoteTransformAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges MIDI note-transform `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getMidiNoteTransformHandlers(): MidiNoteTransformHandlersMap {
    return {
        humanizeNotes: handleHumanizeNotes,
        invertNotes: handleInvertNotes,
        quantizeNoteLengths: handleQuantizeNoteLengths,
        quantizeNotes: handleQuantizeNotes,
        retrogradeNotes: handleRetrogradeNotes,
        scaleAllVelocities: handleScaleAllVelocities,
        scaleVelocities: handleScaleVelocities,
        setAllVelocities: handleSetAllVelocities,
        transposeNotes: handleTransposeNotes,
    };
}
