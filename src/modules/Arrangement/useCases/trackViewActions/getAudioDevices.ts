import { type AudioDeviceInfo, getAudioDevices as getAudioDevicesImpl } from '#/modules/AudioEngine/useCases';

export type { AudioDeviceInfo };

export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
    return getAudioDevicesImpl();
}
