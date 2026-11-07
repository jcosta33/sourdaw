/**
 * A production brief records intent about tracks, sections and ranges; writing it edits none of
 * them, so the ids, figures and beats it holds are data rather than the objects, units or times the
 * command acts on, and an edit to an object it names is no drift for a pending brief write. Its
 * entries' own ids are minted with the brief and name no project object.
 */
export function isRecordedIntentPath(operation: string | undefined, path: string): boolean {
    return operation === 'setProductionBrief' && (path === 'brief' || path.startsWith('brief.'));
}
