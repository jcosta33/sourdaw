import { type CommandObjectReference, type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

function matchesArgument(path: string, argument: string): boolean {
    return path === argument || path.startsWith(`${argument}[`) || path.startsWith(`${argument}.`);
}

export function getVersionedCommandTargetReferences(
    command: VersionedCommandEnvelope
): readonly CommandObjectReference[] {
    const assignedIds = new Set(command.applicationAssignedIds.map((assigned) => assigned.value));
    if (!isExecutableAppActionType(command.operation)) {
        return command.objectReferences.filter((reference) => !assignedIds.has(reference.id));
    }
    const targetArguments = getExecutableCommandRegistration(command.operation).targetChecks.map(
        (rule) => rule.argument
    );
    return command.objectReferences.filter(
        (reference) =>
            !assignedIds.has(reference.id) &&
            targetArguments.some((argument) => matchesArgument(reference.argument, argument))
    );
}
