import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

// §57.1 — Shared rAF-batch primitive (same as the 6 plugin bridges).
export type CrumbsBatchEntry = { instanceId: string; param: string; value: number };

export const paramBatcher = createRafBatcher<CrumbsBatchEntry>();

/**
 * The batch key one parameter of one device coalesces on.
 *
 * Shared with the cancel path rather than rebuilt there: a commit has to cancel the
 * exact key its own drag scheduled, and a key built twice is a key that can be built
 * two ways.
 */
export function crumbsParamCacheKey(instanceId: string, param: string): string {
    return `${instanceId}_${param}`;
}
