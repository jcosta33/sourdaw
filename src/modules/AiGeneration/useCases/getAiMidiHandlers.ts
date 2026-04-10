import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { handleAddNotes } from '../handlers/aiMidi/handleAddNotes';
import { handleAudioToMidiAiMidi } from '../handlers/aiMidi/handleAudioToMidiAiMidi';
import { handleCompleteMidi } from '../handlers/aiMidi/handleCompleteMidi';
import { handleDetectKeyAiMidi } from '../handlers/aiMidi/handleDetectKeyAiMidi';
import { handleDetectTempoAiMidi } from '../handlers/aiMidi/handleDetectTempoAiMidi';
import { handleGenerateAudioAiMidi } from '../handlers/aiMidi/handleGenerateAudioAiMidi';
import { handleGenerateBassline } from '../handlers/aiMidi/handleGenerateBassline';
import { handleStemSeparate } from '../handlers/aiMidi/handleStemSeparate';
import { handleStripSilenceAiMidi } from '../handlers/aiMidi/handleStripSilenceAiMidi';
import { handleVariationMidi } from '../handlers/aiMidi/handleVariationMidi';

type AiMidiAppAction =
    | Extract<AppAction, { type: 'addNotes' }>
    | Extract<AppAction, { type: 'completeMidi' }>
    | Extract<AppAction, { type: 'variationMidi' }>
    | Extract<AppAction, { type: 'generateBassline' }>
    | Extract<AppAction, { type: 'detectTempo' }>
    | Extract<AppAction, { type: 'detectKey' }>
    | Extract<AppAction, { type: 'stripSilence' }>
    | Extract<AppAction, { type: 'audioToMidi' }>
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
        detectTempo: handleDetectTempoAiMidi,
        detectKey: handleDetectKeyAiMidi,
        stripSilence: handleStripSilenceAiMidi,
        audioToMidi: handleAudioToMidiAiMidi,
        generateAudio: handleGenerateAudioAiMidi,
        stemSeparate: handleStemSeparate,
    };
}
