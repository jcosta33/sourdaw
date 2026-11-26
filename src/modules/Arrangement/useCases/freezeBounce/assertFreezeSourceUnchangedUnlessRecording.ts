import { assertFreezeSourceUnchanged } from './assertFreezeSourceUnchanged';
import { isFreezeRefusedWhileRecording } from './isFreezeRefusedWhileRecording';

/**
 * The commit's source check, except that a running take's own provisional clip is not an edit: when
 * a recording start the freeze must yield to is engaged, the change is left for the caller's
 * recording refusal to report, instead of ending the freeze in the changed-while-freezing error.
 */
export function assertFreezeSourceUnchangedUnlessRecording(
    trackId: string,
    renderedSignature: string,
    isCurrentTask: () => boolean
): void {
    try {
        assertFreezeSourceUnchanged(trackId, renderedSignature);
    } catch (error) {
        if (!isCurrentTask()) {
            throw error;
        }
        if (isFreezeRefusedWhileRecording(trackId)) {
            return;
        }
        throw error;
    }
}
