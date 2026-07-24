import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { requestMicPermission } from '../../repositories/audioRecorder/requestMicPermission';

export type AudioDeviceInfo = {
    id: string;
    label: string;
    kind: 'audioinput' | 'audiooutput';
};

type AudioDeviceKind = 'audioinput' | 'audiooutput';
type EnumeratedDevice = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;
type AudioDeviceEntry = EnumeratedDevice & { kind: AudioDeviceKind };

// Generic over the input row so `filter` narrows in place: a concrete
// `MediaDeviceInfo` keeps its own shape (`MediaDeviceInfo & { kind: AudioDeviceKind }`)
// rather than being widened to the Pick, which `Array.filter` would reject as
// not a subtype of the element it was called on.
function isAudioDevice<TDevice extends EnumeratedDevice>(
    device: TDevice
): device is TDevice & { kind: AudioDeviceKind } {
    return device.kind === 'audioinput' || device.kind === 'audiooutput';
}

function toAudioDeviceInfo(device: AudioDeviceEntry): AudioDeviceInfo {
    return {
        id: device.deviceId,
        label: device.label || `Device ${device.deviceId.slice(0, 8)}`,
        kind: device.kind,
    };
}

export const getAudioDevices = inject({ logger, requestMicPermission })(
    ({ logger, requestMicPermission }) =>
        async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
            try {
                const enumerated = await navigator.mediaDevices.enumerateDevices();
                let audioDevices = enumerated.filter(isAudioDevice);

                // Browsers redact every `label` to '' until the page has held a
                // media permission at least once, so an unpermissioned enumerate
                // leaves the device picker showing indistinguishable
                // "Device 1a2b3c4d" rows. Acquire once — `requestMicPermission`
                // stops the stream immediately — then re-enumerate for real names.
                //
                // This is where the prompt lives now that it no longer fires on the
                // first click anywhere in the app (audit RT-8): at the moment a
                // caller actually needs device labels, not at page load.
                //
                // Deliberately narrow: only when EVERY audio device is redacted. An
                // already-permitted page never prompts, and a partially-labelled
                // list (some devices legitimately report '') is left alone.
                const allLabelsRedacted = audioDevices.every((device) => device.label === '');
                if (audioDevices.length > 0 && allLabelsRedacted) {
                    const granted = await requestMicPermission();
                    if (granted) {
                        const relabelled = await navigator.mediaDevices.enumerateDevices();
                        audioDevices = relabelled.filter(isAudioDevice);
                    }
                }

                return audioDevices.map(toAudioDeviceInfo);
            } catch (error) {
                logger.warn(`Failed to enumerate audio devices: ${error}`);
                return [];
            }
        }
);
