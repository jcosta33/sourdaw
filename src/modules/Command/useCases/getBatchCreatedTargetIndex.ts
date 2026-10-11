import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { getVersionedCommandReferencedTargets } from './getVersionedCommandReferencedTargets';

export type BatchCreatedTargetIndex = {
    /** Earliest batch position whose command assigns each id, armTrack aside. */
    firstAssignedAt: ReadonlyMap<string, number>;
    /** Earliest batch position whose declared target arguments reference each id as a stable object. */
    firstReferencedAt: ReadonlyMap<string, number>;
};

/**
 * Indexes each id against the earliest batch position that assigns it and the earliest batch
 * position that references it as a stable target. The references are read raw, before any
 * created-id subtraction, so a collision between one command's assigned id and another
 * command's existing target stays visible here.
 *
 * `armTrack` is excluded from assignments because its `midiInputOwnerId` is not a project
 * entity a later command can target, matching the batch's created-id bookkeeping.
 */
export function getBatchCreatedTargetIndex(commands: readonly VersionedCommandEnvelope[]): BatchCreatedTargetIndex {
    const firstAssignedAt = new Map<string, number>();
    const firstReferencedAt = new Map<string, number>();
    for (const [index, command] of commands.entries()) {
        if (command.operation !== 'armTrack') {
            for (const assigned of command.applicationAssignedIds) {
                if (!firstAssignedAt.has(assigned.value)) {
                    firstAssignedAt.set(assigned.value, index);
                }
            }
        }
        for (const reference of getVersionedCommandReferencedTargets(command)) {
            if (reference.scope !== 'stable' || firstReferencedAt.has(reference.id)) {
                continue;
            }
            firstReferencedAt.set(reference.id, index);
        }
    }
    return { firstAssignedAt, firstReferencedAt };
}
