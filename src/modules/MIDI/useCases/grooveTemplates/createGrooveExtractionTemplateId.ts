/**
 * Mints the id one groove extraction will create. Each extraction adds its own template, so the id
 * is generated where the extraction is described and then pinned in the action, its proposal and
 * its undo entry; redo recreates exactly this id.
 */
export function createGrooveExtractionTemplateId(clipId: string): string {
    return `groove-${clipId}-${crypto.randomUUID()}`;
}
