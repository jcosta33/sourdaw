import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';
import { getVersionedCommandTargetReferences } from './getVersionedCommandTargetReferences';

function matchesArgument(path: string, argument: string): boolean {
    return path === argument || path.startsWith(`${argument}[`) || path.startsWith(`${argument}.`);
}

/**
 * Targets a batch may exempt from the base-revision scope check because they depend on a
 * container an EARLIER command creates: a `dependsOn` target rule only shelters a reference
 * whose dependency argument holds an id minted before the referencing command, since commands
 * execute in order and a later-created id cannot back an earlier container.
 */
export function getBatchLocalDependentTargetIds(commands: readonly VersionedCommandEnvelope[]): ReadonlySet<string> {
    const dependentTargetIds = new Set<string>();
    for (const [index, command] of commands.entries()) {
        if (!isExecutableAppActionType(command.operation)) {
            continue;
        }
        const targetRules = getExecutableCommandRegistration(command.operation).targetChecks;
        const createdEarlier = new Set<string>();
        for (const producer of commands.slice(0, index)) {
            if (producer.operation === 'armTrack') {
                continue;
            }
            for (const assigned of producer.applicationAssignedIds) {
                createdEarlier.add(assigned.value);
            }
        }
        for (const reference of getVersionedCommandTargetReferences(command)) {
            const targetRule = targetRules.find((rule) => matchesArgument(reference.argument, rule.argument));
            if (!targetRule || !('dependsOn' in targetRule)) {
                continue;
            }
            const dependencyId = command.arguments[targetRule.dependsOn];
            if (typeof dependencyId === 'string' && createdEarlier.has(dependencyId)) {
                dependentTargetIds.add(reference.id);
            }
        }
    }
    return dependentTargetIds;
}
