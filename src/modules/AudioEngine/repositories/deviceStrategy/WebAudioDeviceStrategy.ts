import { type Device } from '../../models/TrackViewTypes';
import { resolveDeviceParamTargets } from '../../services/deviceResolution';
import { applyParams } from '../applyParams';
import { type OfflineDeviceNode, createOfflineDeviceNode } from '../deviceNodeFactory';

import { type AudioDeviceStrategy, type OfflineAutomationBinding } from './AudioDeviceStrategy';

export class WebAudioDeviceStrategy implements AudioDeviceStrategy {
    constructor(
        public readonly node: OfflineDeviceNode,
        private readonly deviceType: string
    ) {}

    setParam(name: string, value: number): void {
        applyParams(this.node, this.deviceType, { [name]: value });
    }

    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null {
        const targets = resolveDeviceParamTargets(this.deviceType, parameterId, this.node);
        if (targets.length === 0) {
            return null;
        }
        return { kind: 'audioParam', targets };
    }
}

export function createWebAudioDevice(ctx: BaseAudioContext, device: Device): WebAudioDeviceStrategy {
    const node = createOfflineDeviceNode({
        context: ctx,
        device,
        deviceType: device.type,
    });
    if (!node) {
        throw new Error(`Unknown WebAudio device type: ${device.type}`);
    }
    applyParams(node, device.type, device.parameterValues);
    return new WebAudioDeviceStrategy(node, device.type);
}
