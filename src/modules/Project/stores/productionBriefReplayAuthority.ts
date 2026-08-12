import { type AppAction } from '#/utils/handlerContract';

type ProductionBriefAction = Extract<AppAction, { type: 'setProductionBrief' }>;

const authorizedReplayActions = new WeakSet<ProductionBriefAction>();

export function authorizeProductionBriefReplay(action: ProductionBriefAction): ProductionBriefAction {
    authorizedReplayActions.add(action);
    return action;
}

export function isAuthorizedProductionBriefReplay(action: ProductionBriefAction): boolean {
    return authorizedReplayActions.has(action);
}
