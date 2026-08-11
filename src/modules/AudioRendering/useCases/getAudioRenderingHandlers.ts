import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleRemoveRenderedProjectSections } from '../handlers/handleRemoveRenderedProjectSections';
import { handleRenderProjectSections } from '../handlers/handleRenderProjectSections';

type AudioRenderingAction =
    | Extract<AppAction, { type: 'renderProjectSections' }>
    | Extract<AppAction, { type: 'removeRenderedProjectSections' }>;

type AudioRenderingHandlersMap = {
    [Action in AudioRenderingAction as Action['type']]: ActionHandler<Action>;
};

export function getAudioRenderingHandlers(): AudioRenderingHandlersMap {
    return {
        renderProjectSections: handleRenderProjectSections,
        removeRenderedProjectSections: handleRemoveRenderedProjectSections,
    };
}
