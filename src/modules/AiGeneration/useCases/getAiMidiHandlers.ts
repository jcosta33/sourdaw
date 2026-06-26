import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleAddNotes } from '../handlers/aiMidi/handleAddNotes';
import { handleCompleteMidi } from '../handlers/aiMidi/handleCompleteMidi';
import { handleGenerateAudioAiMidi } from '../handlers/aiMidi/handleGenerateAudioAiMidi';
import { handleGenerateBassline } from '../handlers/aiMidi/handleGenerateBassline';
import { handleStemSeparate } from '../handlers/aiMidi/handleStemSeparate';
import { handleVariationMidi } from '../handlers/aiMidi/handleVariationMidi';

/**
 * Clip analysis actions (`detectTempo`, `detectKey`, `audioToMidi`) are registered in
 * `AudioAnalysis`'s `getAnalysisHandlers`, and `stripSilence` in `Arrangement`'s `clipHandlers`.
 * They are deliberately not registered here — registering them in two maps would collide on
 * the shared action key and throw in `registerHandlerMap`.
 */
type AiMidiAppAction =
    | Extract<AppAction, { type: 'addNotes' }>
    | Extract<AppAction, { type: 'completeMidi' }>
    | Extract<AppAction, { type: 'variationMidi' }>
    | Extract<AppAction, { type: 'generateBassline' }>
    | Extract<AppAction, { type: 'generateAudio' }>
    | Extract<AppAction, { type: 'stemSeparate' }>;

export type AiMidiHandlersMap = {
    [Action in AiMidiAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges AI MIDI / analysis `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getAiMidiHandlers(): AiMidiHandlersMap {
    return {
        addNotes: handleAddNotes,
        completeMidi: handleCompleteMidi,
        variationMidi: handleVariationMidi,
        generateBassline: handleGenerateBassline,
        generateAudio: handleGenerateAudioAiMidi,
        stemSeparate: handleStemSeparate,
    };
}
