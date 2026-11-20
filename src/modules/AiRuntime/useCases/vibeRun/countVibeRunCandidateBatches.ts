import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { readExplicitProtections } from '../agentReference/readExplicitProtections';

import { readVibeRunCandidates } from './readVibeRunCandidates';
import { withBriefRoleContext } from './withBriefRoleContext';

/**
 * How many batches the authored recipes would plan for these characters on this project, before
 * anything is measured: the same candidate step a vibe run begins with, so a reading that counts zero
 * here would schedule nothing.
 */
export function countVibeRunCandidateBatches(
    input: Parameters<typeof readVibeRunCandidates>[0] & { prompt: string }
): number {
    const protections = readExplicitProtections(input.prompt, withBriefRoleContext(input.context, input.brief));
    return readVibeRunCandidates(input, getMixRecipeCatalog(), protections.protectedTrackIds).plan.batches.length;
}
