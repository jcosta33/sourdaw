import { type Device } from '../../models/TrackViewTypes';
import { resolveDeviceParamTargets } from '../../services/deviceResolution';
import { applyParams } from '../applyParams';
import { type OfflineDeviceNode, createOfflineDeviceNode } from '../deviceNodeFactory';

import { type AudioDeviceStrategy, type OfflineAutomationBinding } from './AudioDeviceStrategy';
import { UnsupportedDeviceTypeError } from './unsupportedDeviceTypeError';

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
        // The `builtin-` prefix matcher claims every builtin id, so reaching
        // this line means the registry routed a type here that
        // `createOfflineDeviceNode` has no node for. That is a coverage hole in
        // our own code, not a runtime failure, so it must be typed as one.
        throw new UnsupportedDeviceTypeError(
            device.type,
            'the builtin- matcher claimed it but deviceNodeFactory builds no node for it'
        );
    }
    applyParams(node, device.type, device.parameterValues);
    return new WebAudioDeviceStrategy(node, device.type);
}
