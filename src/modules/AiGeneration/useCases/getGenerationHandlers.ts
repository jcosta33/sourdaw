import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleApplyGroove } from '../handlers/generation/handleApplyGroove';
import { handleExtractGroove } from '../handlers/generation/handleExtractGroove';
import { handleGenerateChordProgression } from '../handlers/generation/handleGenerateChordProgression';
import { handleGenerateDrumPattern } from '../handlers/generation/handleGenerateDrumPattern';
import { handleGenerateMelody } from '../handlers/generation/handleGenerateMelody';

type GenerationAppAction =
    | Extract<AppAction, { type: 'generateDrumPattern' }>
    | Extract<AppAction, { type: 'generateMelody' }>
    | Extract<AppAction, { type: 'generateChordProgression' }>
    | Extract<AppAction, { type: 'extractGroove' }>
    | Extract<AppAction, { type: 'applyGroove' }>;

/** Each key is the `AppAction['type']` discriminant; each value is typed to that action only. */
export type GenerationHandlersMap = {
    [Action in GenerationAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges AI generation `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getGenerationHandlers(): GenerationHandlersMap {
    return {
        generateDrumPattern: handleGenerateDrumPattern,
        generateMelody: handleGenerateMelody,
        generateChordProgression: handleGenerateChordProgression,
        extractGroove: handleExtractGroove,
        applyGroove: handleApplyGroove,
    };
}
