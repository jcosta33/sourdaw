import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { audioEngine } from '../../repositories/createWebAudioEngine';
import { audioDeviceStore } from './helpers';

export const setOutputDevice = inject({ logger })(
    ({ logger }) =>
        (async function setOutputDevice(deviceId: string): Promise<void> {
            if ('setSinkId' in audioEngine.context) {
                try {
                    await (audioEngine.context as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(
                        deviceId
                    );
                } catch (error) {
                    logger.warn(`Failed to set output device: ${error}`);
                }
            }
            const current = audioDeviceStore.value;
            audioDeviceStore.set({ ...current!, selectedOutputId: deviceId });
        })
);