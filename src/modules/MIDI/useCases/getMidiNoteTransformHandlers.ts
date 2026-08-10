import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleAddNotes } from '../handlers/noteCrud/handleAddNotes';
import { handleCopyMidiArticulations } from '../handlers/noteTransform/handleCopyMidiArticulations';
import { handleHumanizeNotes } from '../handlers/noteTransform/handleHumanizeNotes';
import { handleInvertNotes } from '../handlers/noteTransform/handleInvertNotes';
import { handleQuantizeNoteLengths } from '../handlers/noteTransform/handleQuantizeNoteLengths';
import { handleQuantizeNotes } from '../handlers/noteTransform/handleQuantizeNotes';
import { handleRestoreMidiClipNotes } from '../handlers/noteTransform/handleRestoreMidiClipNotes';
import { handleRetrogradeNotes } from '../handlers/noteTransform/handleRetrogradeNotes';
import { handleScaleAllVelocities } from '../handlers/noteTransform/handleScaleAllVelocities';
import { handleScaleVelocities } from '../handlers/noteTransform/handleScaleVelocities';
import { handleSetAllVelocities } from '../handlers/noteTransform/handleSetAllVelocities';
import { handleTransposeNotes } from '../handlers/noteTransform/handleTransposeNotes';

type MidiNoteTransformAppAction =
    | Extract<AppAction, { type: 'addNotes' }>
    | Extract<AppAction, { type: 'copyMidiArticulations' }>
    | Extract<AppAction, { type: 'humanizeNotes' }>
    | Extract<AppAction, { type: 'invertNotes' }>
    | Extract<AppAction, { type: 'quantizeNoteLengths' }>
    | Extract<AppAction, { type: 'quantizeNotes' }>
    | Extract<AppAction, { type: 'restoreMidiClipNotes' }>
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
        addNotes: handleAddNotes,
        copyMidiArticulations: handleCopyMidiArticulations,
        humanizeNotes: handleHumanizeNotes,
        invertNotes: handleInvertNotes,
        quantizeNoteLengths: handleQuantizeNoteLengths,
        quantizeNotes: handleQuantizeNotes,
        restoreMidiClipNotes: handleRestoreMidiClipNotes,
        retrogradeNotes: handleRetrogradeNotes,
        scaleAllVelocities: handleScaleAllVelocities,
        scaleVelocities: handleScaleVelocities,
        setAllVelocities: handleSetAllVelocities,
        transposeNotes: handleTransposeNotes,
    };
}
