import { type Logger } from '#/infra/logger/types';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { setBacteriaModAssignmentsWithAudio } from './bacteriaParamBridge/setBacteriaModAssignmentsWithAudio';
import { hydrateBacteriaModAssignmentsFromProject } from './hydrateBacteriaModAssignmentsFromProject';

type AudioDeviceLifecyclePayload = { deviceId: string; deviceType: string };

type BacteriaSubscriberEventBus = {
    on(event: 'audioDevice.loaded', handler: (payload: AudioDeviceLifecyclePayload) => void): () => void;
};

/**
 * Re-apply a device's persisted modulation-routing table once its live worklet
 * finishes loading.
 *
 * A freshly built Bacteria worklet always starts with an empty routing table —
 * nothing in its construction reads the document. Without this, every reload
 * silently drops the routing even though `commitBacteriaModAssignments` faithfully
 * wrote it: the document was correct, the panel just never asked it for the
 * table on the device's next appearance.
 *
 * `setBacteriaModAssignmentsWithAudio` both writes the session store and pushes
 * the table to the worklet through `updateDevicePatch`, so this one call restores
 * both halves of the state the panel and the engine share.
 */
export function initBacteriaSubscribers(input: {
    eventBus: BacteriaSubscriberEventBus;
    logger: Pick<Logger, 'info'>;
}): () => void {
    return input.eventBus.on('audioDevice.loaded', (payload) => {
        if (payload.deviceType !== DEVICE_TYPE_IDS.bacteria) {
            return;
        }

        const assignments = hydrateBacteriaModAssignmentsFromProject(payload.deviceId);
        if (!assignments || assignments.length === 0) {
            return;
        }

        input.logger.info('Hydrating newly loaded Bacteria engine with the project modulation routing');
        setBacteriaModAssignmentsWithAudio(payload.deviceId, assignments);
    });
}
