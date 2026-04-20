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
                    .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
                    .map((d) => ({
                        id: d.deviceId,
                        label: d.label || `Device ${d.deviceId.slice(0, 8)}`,
                        kind: d.kind as 'audioinput' | 'audiooutput',
                    }));
            } catch (error) {
                logger.warn(`Failed to enumerate audio devices: ${error}`);
                return [];
            }
        }
);
