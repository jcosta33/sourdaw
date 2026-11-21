import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type GrooveTemplateState } from '../../models/GrooveTemplateState';

import { grooveTemplateProjectorByActionType } from './grooveTemplateProjectorByActionType';

function projectAction<Type extends AppActionType>(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: Type }>
): GrooveTemplateState {
    if (!Object.hasOwn(grooveTemplateProjectorByActionType, action.type)) {
        return state;
    }
    return grooveTemplateProjectorByActionType[action.type](state, action);
}

/**
 * The groove pool and its assignments as they will be once the given batch actions have run, so a
 * later action in the same batch validates and describes its inverse against the state it will meet
 * rather than the live store, which no action of the batch has written yet. An action that would
 * refuse at execution leaves the projection unchanged; the batch then fails as a whole.
 */
export function projectGrooveTemplateState(
    state: GrooveTemplateState,
    actions: readonly AppAction[]
): GrooveTemplateState {
    return actions.reduce((current, action) => projectAction(current, action), state);
}
