import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode, DEVICE_FACTORIES, applyParams } from '../deviceNodeFactory';

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
    const factory = DEVICE_FACTORIES[device.type];
    if (!factory) {
        throw new Error(`Unknown WebAudio device type: ${device.type}`);
    }
    const node = factory(ctx);
    applyParams(node, device.type, device.parameterValues);
    return new WebAudioDeviceStrategy(node, device.type);
}
