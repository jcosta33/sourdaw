import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';
import { getVersionedCommandTargetReferences } from './getVersionedCommandTargetReferences';

function matchesArgument(path: string, argument: string): boolean {
    return path === argument || path.startsWith(`${argument}[`) || path.startsWith(`${argument}.`);
}

export function getBatchLocalDependentTargetIds(
    commands: readonly VersionedCommandEnvelope[],
    createdTargetIds: ReadonlySet<string>
): ReadonlySet<string> {
    const dependentTargetIds = new Set<string>();
    for (const command of commands) {
        if (!isExecutableAppActionType(command.operation)) {
            continue;
        }
        const targetRules = getExecutableCommandRegistration(command.operation).targetChecks;
        for (const reference of getVersionedCommandTargetReferences(command)) {
            const targetRule = targetRules.find((rule) => matchesArgument(reference.argument, rule.argument));
            if (!targetRule || !('dependsOn' in targetRule)) {
                continue;
            }
            const dependencyId = command.arguments[targetRule.dependsOn];
            if (typeof dependencyId === 'string' && createdTargetIds.has(dependencyId)) {
                dependentTargetIds.add(reference.id);
            }
        }
    }
    return dependentTargetIds;
}
