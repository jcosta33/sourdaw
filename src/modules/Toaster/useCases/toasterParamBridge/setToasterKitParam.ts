import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type ToasterKit } from '../../models/ToasterKit';
import { updateKit } from '../../stores/toasterStore';

import { findDeviceRef } from './helpers';

const KIT_PARAM_MAP = {
    swing: 'swing',
    masterGain: 'master_gain',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    lofiBits: 'lofi_bits',
    lofiRate: 'lofi_rate',
    lofiMix: 'lofi_mix',
} as const;

export function setToasterKitParam<K extends keyof typeof KIT_PARAM_MAP>(
    deviceId: string,
    key: K,
    value: ToasterKit[K]
): void {
    updateKit({ [key]: value } as Partial<ToasterKit>);

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const paramName = KIT_PARAM_MAP[key];
    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return;
    }
    const deviceNode = strip.deviceNodes.find(
        (device) => device.toasterControls && device.toasterControls.ready !== undefined
    );
    if (deviceNode?.toasterControls) {
        deviceNode.toasterControls.setParam(paramName, value as number);
    }
}
