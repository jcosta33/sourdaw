import { stopAudioRecording } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { noTakeTargetMessage } from './noTakeTargetMessage';

/**
 * A recording start whose admission or count-in found no track left to take a
 * take (every armed track froze meanwhile) ends here: the capture readers and
 * any hardware capture it began are released and the user is told why, so the
 * transport never engages a recording that captures nothing. Resolves `false`,
 * the start's "recording did not begin" answer.
 */
export async function releaseTakelessRecordingStart(detachReaders: () => void): Promise<false> {
    detachReaders();
    await stopAudioRecording();
    notifyUser(noTakeTargetMessage(), 'warning');
    return false;
}
