import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

export function getPlannedActionAffectedIds(action: AppAction): string[] {
    const affectedIds = new Set<string>();
    const payload: Readonly<Record<string, unknown>> = action.payload ?? {};
    const groundingRules = getExecutableAppActionGroundingRules(action.type);
    for (const targetRule of groundingRules?.targetRules ?? []) {
        const value = payload[targetRule.argument];
        if (typeof value === 'string') {
            affectedIds.add(value);
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'string') {
                    affectedIds.add(item);
                }
            }
        }
    }
    if (action.type === 'createBus' && action.payload.busId) {
        affectedIds.add(action.payload.busId);
    }
    if (action.type === 'automateSendRange' && action.payload.sectionId) {
        affectedIds.add(action.payload.sectionId);
    }
    return [...affectedIds];
}
