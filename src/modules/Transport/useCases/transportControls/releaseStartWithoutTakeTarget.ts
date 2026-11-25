import { stopAudioRecording } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { hasArmedTakeTarget } from './hasArmedTakeTarget';
import { noTakeTargetMessage } from './noTakeTargetMessage';

/**
 * A recording start that finds no take target left after its count-in or input
 * admission (every armed track froze meanwhile) ends here: the capture readers
 * and any hardware capture it began are released and the user is told why, so
 * the transport never engages a recording that captures nothing. An empty clip
 * list alone is no such sign, since an overdub opens no new clip. Resolves
 * `true` when the start was released.
 */
export async function releaseStartWithoutTakeTarget(detachReaders: () => void): Promise<boolean> {
    if (hasArmedTakeTarget()) {
        return false;
    }
    detachReaders();
    await stopAudioRecording();
    notifyUser(noTakeTargetMessage(), 'warning');
    return true;
}
