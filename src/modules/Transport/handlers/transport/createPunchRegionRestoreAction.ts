import { type AppAction } from '#/utils/handlerContract';

type RestorePunchRegionAction = Extract<AppAction, { type: 'restorePunchRegion' }>;

export function createPunchRegionRestoreAction(payload: RestorePunchRegionAction['payload']): RestorePunchRegionAction {
    return {
        type: 'restorePunchRegion',
        payload,
    };
}
