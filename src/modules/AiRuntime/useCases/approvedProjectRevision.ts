import { captureProjectRevision, projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';

/**
 * True while the live project still holds the content an approval was bound to: root may have moved
 * only by the command-batch checkpoint and by what a save writes (its timestamp and the active
 * arrangement's copy of the live slots). The card, confirmation admission, the execution preflight
 * and the final approval binding all ask this one question, so a save neither forces a second
 * Confirm nor passes one gate only to be refused by the next.
 */
function matchesLive(approvedRevision: string): boolean {
    return projectRevisionMatchesLiveIgnoringSaveWrites(approvedRevision);
}

/**
 * The revision to validate an approval against. While live content matches the approved revision
 * that is the approved revision itself, so the approval's own source revision stays exact; otherwise
 * it is the live revision, which the exact source-revision check then refuses as stale.
 */
function readValidationRevision(approvedRevision: string): string {
    if (matchesLive(approvedRevision)) {
        return approvedRevision;
    }
    return captureProjectRevision();
}

export const approvedProjectRevision = { matchesLive, readValidationRevision };
