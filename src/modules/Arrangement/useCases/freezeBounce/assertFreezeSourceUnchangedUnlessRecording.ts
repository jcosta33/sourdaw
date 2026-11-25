import { assertFreezeSourceUnchanged } from './assertFreezeSourceUnchanged';
import { isFreezeRefusedWhileRecording } from './isFreezeRefusedWhileRecording';

/**
 * The commit's source check, except that a running take's own provisional clip is not an edit: when
 * a recording start the freeze must yield to is engaged, the change is left for the caller's
 * recording refusal to report, instead of ending the freeze in the changed-while-freezing error.
 */
export async function assertFreezeSourceUnchangedUnlessRecording(
    trackId: string,
    renderedSourceHash: string,
    isCurrentTask: () => boolean
): Promise<void> {
    try {
        await assertFreezeSourceUnchanged(trackId, renderedSourceHash);
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
