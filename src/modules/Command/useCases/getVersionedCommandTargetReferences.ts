import { type CommandObjectReference, type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { getVersionedCommandReferencedTargets } from './getVersionedCommandReferencedTargets';

export function getVersionedCommandTargetReferences(
    command: VersionedCommandEnvelope
): readonly CommandObjectReference[] {
    const assignedIds = new Set(command.applicationAssignedIds.map((assigned) => assigned.value));
    return getVersionedCommandReferencedTargets(command).filter((reference) => !assignedIds.has(reference.id));
}
