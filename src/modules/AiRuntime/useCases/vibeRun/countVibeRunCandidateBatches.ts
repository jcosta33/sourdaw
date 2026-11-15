import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { readExplicitProtections } from '../agentReference/readExplicitProtections';

import { readVibeRunCandidates } from './readVibeRunCandidates';

/**
 * How many batches the authored recipes would plan for these characters on this project, before
 * anything is measured: the same candidate step a vibe run begins with, so a reading that counts zero
 * here would schedule nothing.
 */
export function countVibeRunCandidateBatches(
    input: Parameters<typeof readVibeRunCandidates>[0] & { prompt: string }
): number {
    const protections = readExplicitProtections(input.prompt, input.context);
    return readVibeRunCandidates(input, getMixRecipeCatalog(), protections.protectedTrackIds).plan.batches.length;
}
