import {
    projectRevisionMatchesLiveIgnoringSaveWrites,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';

/**
 * True while the project still holds the content `projectRevision` captured, once every store write
 * still waiting on its frame has reached the document, so an edit not yet flushed counts as an edit.
 * A save is no change; any other content change, saved or not, is.
 */
export function settledProjectContentMatches(projectRevision: string): boolean {
    settlePendingProjectWritesAndCaptureRevision();
    return projectRevisionMatchesLiveIgnoringSaveWrites(projectRevision);
}
