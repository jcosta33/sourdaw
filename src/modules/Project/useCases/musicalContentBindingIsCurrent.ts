import {
    projectRevisionMatchesLiveIgnoringSaveWrites,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { readPianoRollSelection } from '#/modules/MIDI/useCases';

import { type captureMusicalContentBinding } from './captureMusicalContentBinding';

export function musicalContentBindingIsCurrent(binding: ReturnType<typeof captureMusicalContentBinding>): boolean {
    settlePendingProjectWritesAndCaptureRevision();
    return (
        projectRevisionMatchesLiveIgnoringSaveWrites(binding.expectedRevision) &&
        readPianoRollSelection().token === binding.selectionToken
    );
}
