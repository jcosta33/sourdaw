import { resetMemberExpressionState } from './resetMemberExpressionState';
import { webMidiRuntime } from './state';

export function setTargetTrackId(id: string | null, ownerId: string | null = null): void {
    if (webMidiRuntime.targetTrackId !== id) {
        resetMemberExpressionState();
    }
    webMidiRuntime.targetTrackId = id;
    webMidiRuntime.targetTrackOwnerId = ownerId;
    webMidiRuntime.targetTrackRevision += 1;
}
