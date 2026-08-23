import { type AppAction } from '#/utils/handlerContract';

import { compileCommandArgumentMetadata } from './commandArgumentMetadata';
import { getExecutableAppActionGroundingRules } from './getExecutableAppActionGroundingRules';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesArgument(path: string, argument: string): boolean {
    return path === argument || path.startsWith(`${argument}[`) || path.startsWith(`${argument}.`);
}

/** Static command authority derived by the same argument metadata contract as command envelopes. */
export function getAppActionStaticAuthority(action: AppAction): {
    targetIds: string[];
    targetRange?: { startBeat: number; endBeat: number };
} {
    const payload = 'payload' in action && isRecord(action.payload) ? action.payload : {};
    const metadata = compileCommandArgumentMetadata(payload);
    const targetArguments =
        getExecutableAppActionGroundingRules(action.type)?.targetRules.map((rule) => rule.argument) ?? [];
    const targetIds = metadata.objectReferences
        .filter(
            (reference) =>
                reference.scope === 'stable' &&
                targetArguments.some((argument) => matchesArgument(reference.argument, argument))
        )
        .map((reference) => reference.id);
    const beats = metadata.time
        .filter((time) => time.domain === 'musical' && time.unit === 'beats')
        .map((time) => time.value);
    return {
        targetIds,
        ...(beats.length === 0 ? {} : { targetRange: { startBeat: Math.min(...beats), endBeat: Math.max(...beats) } }),
    };
}
