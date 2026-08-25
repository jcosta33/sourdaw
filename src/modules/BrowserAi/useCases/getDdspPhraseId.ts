/** Canonical queue/status identity for one clip's DDSP preview. */
export function getDdspPhraseId(clipId: string): string {
    return `${clipId}-ddsp`;
}
