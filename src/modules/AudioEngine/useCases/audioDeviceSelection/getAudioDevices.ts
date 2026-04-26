import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

export type AudioDeviceInfo = {
    id: string;
    label: string;
    kind: 'audioinput' | 'audiooutput';
};

export const getAudioDevices = inject({ logger })(
    ({ logger }) =>
        async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                return devices
                    .filter((data) => data.kind === 'audioinput' || data.kind === 'audiooutput')
                    .map((data) => ({
                        id: data.deviceId,
                        label: data.label || `Device ${data.deviceId.slice(0, 8)}`,
                        kind: data.kind as 'audioinput' | 'audiooutput',
                    }));
            } catch (error) {
                logger.warn(`Failed to enumerate audio devices: ${error}`);
                return [];
            }
        }
);
