import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';
import { readPianoRollSelection } from '#/modules/MIDI/useCases';

/** Capture once for the planning run; never recapture when a query or continuation arrives. */
export function captureMusicalContentBinding() {
    const expectedRevision = settlePendingProjectWritesAndCaptureRevision();
    return { expectedRevision, selectionToken: readPianoRollSelection().token };
}
