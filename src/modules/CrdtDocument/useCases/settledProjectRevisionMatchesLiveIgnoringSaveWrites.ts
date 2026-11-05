import { projectRevisionMatchesLiveIgnoringSaveWrites } from './projectRevisionMatchesLiveIgnoringSaveWrites';
import { settlePendingProjectWritesAndCaptureRevision } from './settlePendingProjectWritesAndCaptureRevision';

/**
 * As `projectRevisionMatchesLiveIgnoringSaveWrites`, once every store write still waiting on its
 * animation frame has reached the document. A store shows its edit before the frame writes it, so
 * without the settle that edit would read as no change.
 */
export function settledProjectRevisionMatchesLiveIgnoringSaveWrites(expectedRevision: string): boolean {
    settlePendingProjectWritesAndCaptureRevision();
    return projectRevisionMatchesLiveIgnoringSaveWrites(expectedRevision);
}
