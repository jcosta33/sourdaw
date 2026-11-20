import { type Logger } from '#/infra/logger/types';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { notifyGrandBouleRuntimeReady } from '../stores/grandBouleRuntimeNotifications';

import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

type AudioDeviceLifecyclePayload = { deviceId: string; deviceType: string };

type GrandBouleSubscriberEventBus = {
    on(event: 'audioDevice.loaded', handler: (payload: AudioDeviceLifecyclePayload) => void): () => void;
};

export function initGrandBouleSubscribers(input: {
    eventBus: GrandBouleSubscriberEventBus;
    logger: Pick<Logger, 'info'>;
}): () => void {
    return input.eventBus.on('audioDevice.loaded', (payload) => {
        if (payload.deviceType !== DEVICE_TYPE_IDS.grandBoule) {
            return;
        }
        try {
            input.logger.info('Hydrating newly loaded Grand Boule engine with project state');
            reconcileGrandBouleDeviceStateFromProject(payload.deviceId);
        } finally {
            notifyGrandBouleRuntimeReady(payload.deviceId);
        }
    });
}
