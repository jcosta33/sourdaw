import { type CommandObjectReference } from '../models/VersionedCommandEnvelope';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

function matchesArgument(path: string, argument: string): boolean {
    return path === argument || path.startsWith(`${argument}[`) || path.startsWith(`${argument}.`);
}

/**
 * Every object reference a command makes through an argument its descriptor declares as a target,
 * whether or not the command also records the id as one it assigned. The scope check reads the
 * references that remain once assigned ids are set aside; the parser reads these to refuse a record
 * that sets aside an id the command points at.
 */
export function getVersionedCommandReferencedTargets(command: {
    operation: string;
    objectReferences: readonly CommandObjectReference[];
}): readonly CommandObjectReference[] {
    if (!isExecutableAppActionType(command.operation)) {
        return command.objectReferences;
    }
    const targetArguments = getExecutableCommandRegistration(command.operation).targetChecks.map(
        (rule) => rule.argument
    );
    return command.objectReferences.filter((reference) =>
        targetArguments.some((argument) => matchesArgument(reference.argument, argument))
    );
}
