import { notifyUser } from '#/utils/Notification/notifyUser';

import { hasArmedTakeTarget } from './hasArmedTakeTarget';
import { noTakeTargetMessage } from './noTakeTargetMessage';

/**
 * Record needs a take target: `startRecording` opens takes on armed, recording
 * eligible, unfrozen tracks, and with none the transport would present an
 * engaged recording that captures nothing (#3679). Tells the user why and
 * returns true when the gesture must stop.
 */
export function refusesWithoutTakeTarget(): boolean {
    if (hasArmedTakeTarget()) {
        return false;
    }
    notifyUser(noTakeTargetMessage(), 'warning');
    return true;
}
