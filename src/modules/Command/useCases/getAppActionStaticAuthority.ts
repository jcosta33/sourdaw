import { type AppAction } from '#/utils/handlerContract';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

/** Returns only registry-declared, already-materialized stable target IDs. */
export function getAppActionStaticAuthority(action: AppAction): readonly string[] {
    if (!isExecutableAppActionType(action.type)) {
        return [];
    }
    const payload: Readonly<Record<string, unknown>> = action.payload ?? {};
    const targetIds: string[] = [];
    for (const targetRule of getExecutableCommandRegistration(action.type).targetChecks) {
        const value = payload[targetRule.argument];
        let candidates: readonly unknown[] = [];
        if (typeof value === 'string') {
            candidates = [value];
        } else if (Array.isArray(value)) {
            candidates = value;
        }
        for (const candidate of candidates) {
            if (
                typeof candidate === 'string' &&
                candidate.length > 0 &&
                !candidate.startsWith('$') &&
                !targetIds.includes(candidate)
            ) {
                targetIds.push(candidate);
            }
        }
    }
    return targetIds;
}
