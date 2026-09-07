import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { audioEngine } from '../../repositories/createWebAudioEngine';

import { audioDeviceStore } from './helpers';

type AudioContextWithSinkId = AudioContext & {
    setSinkId?: (deviceId: string) => Promise<void>;
};

let outputDeviceQueue: Promise<void> = Promise.resolve();

export const setOutputDevice = inject({ logger, notifyUser })(
    ({ logger, notifyUser }) =>
        function setOutputDevice(deviceId: string): Promise<void> {
            const request = outputDeviceQueue.then(async () => {
                const context = audioEngine.context as AudioContextWithSinkId;
                if (typeof context.setSinkId !== 'function') {
                    logger.warn('Failed to set output device: setSinkId is unavailable');
                    notifyUser('Unable to set output device.', 'error');
                    return;
                }

                try {
                    await context.setSinkId(deviceId);
                } catch (error) {
                    logger.warn(`Failed to set output device: ${error}`);
                    notifyUser('Unable to set output device.', 'error');
                    return;
                }

                const current = audioDeviceStore.value;
                audioDeviceStore.set({ ...current!, selectedOutputId: deviceId });
            });

            outputDeviceQueue = request.catch(() => undefined);
            return request;
        }
);
