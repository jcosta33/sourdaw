import { memberExpressionState } from './memberExpressionState';
import { webMidiRuntime } from './state';

export function setTargetTrackId(id: string | null, ownerId: string | null = null): void {
    if (webMidiRuntime.targetTrackId !== id) {
        memberExpressionState.clear();
    }
    webMidiRuntime.targetTrackId = id;
    webMidiRuntime.targetTrackOwnerId = ownerId;
    webMidiRuntime.targetTrackRevision += 1;
}
