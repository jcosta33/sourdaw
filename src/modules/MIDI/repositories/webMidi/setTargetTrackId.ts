import { heldPedalState } from './heldPedalState';
import { resetMemberExpressionState } from './resetMemberExpressionState';
import { webMidiRuntime } from './state';

export function setTargetTrackId(id: string | null, ownerId: string | null = null): void {
    if (webMidiRuntime.targetTrackId !== id) {
        resetMemberExpressionState();
        // A pedal pressed while another track was the target never reached this
        // one's instrument, so a take must not start it down here.
        heldPedalState.clear();
    }
    webMidiRuntime.targetTrackId = id;
    webMidiRuntime.targetTrackOwnerId = ownerId;
    webMidiRuntime.targetTrackRevision += 1;
}
