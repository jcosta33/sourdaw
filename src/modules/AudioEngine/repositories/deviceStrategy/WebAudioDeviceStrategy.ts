import { type Device } from '../../models/TrackViewTypes';
import { applyParams } from '../applyParams';
import { type OfflineDeviceNode, createOfflineDeviceNode } from '../deviceNodeFactory';

import { type AudioDeviceStrategy } from './AudioDeviceStrategy';

export class WebAudioDeviceStrategy implements AudioDeviceStrategy {
    constructor(
        public readonly node: OfflineDeviceNode,
        private readonly deviceType: string
    ) {}

    setParam(name: string, value: number): void {
        applyParams(this.node, this.deviceType, { [name]: value });
    }
}

export function createWebAudioDevice(ctx: BaseAudioContext, device: Device): WebAudioDeviceStrategy {
    const node = createOfflineDeviceNode({
        context: ctx,
        deviceId: device.id,
        deviceType: device.type,
    });
    if (!node) {
        throw new Error(`Unknown WebAudio device type: ${device.type}`);
    }
    applyParams(node, device.type, device.parameterValues);
    return new WebAudioDeviceStrategy(node, device.type);
}
