import { type BatchCreatedTargetIndex } from './getBatchCreatedTargetIndex';

/**
 * A batch creates an id only when the first command referencing it comes after the command
 * assigning it: commands execute in order, so a reference at or before the assignment names a
 * pre-existing object the assignment would shadow, never a batch creation.
 */
export function isBatchCreatedTargetId(index: BatchCreatedTargetIndex, targetId: string): boolean {
    const creator = index.firstAssignedAt.get(targetId);
    return creator !== undefined && (index.firstReferencedAt.get(targetId) ?? Number.POSITIVE_INFINITY) > creator;
}
