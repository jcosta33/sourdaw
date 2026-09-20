import { type Device } from '../../models/TrackViewTypes';
import { resolveDeviceCurveWriteTargets, resolveDeviceParamTargets } from '../../services/deviceResolution';
import { applyParams } from '../applyParams';
import { type OfflineDeviceNode, createOfflineDeviceNode } from '../deviceNodeFactory';

import { type AudioDeviceStrategy, type OfflineAutomationBinding } from './AudioDeviceStrategy';
import { UnsupportedDeviceTypeError } from './unsupportedDeviceTypeError';

export class WebAudioDeviceStrategy implements AudioDeviceStrategy {
    /** Builtin Web Audio graphs are inserts and generators driven by params, never by notes. */
    public readonly acceptsNotes = false;

    constructor(
        public readonly node: OfflineDeviceNode,
        private readonly deviceType: string
    ) {}

    setParam(name: string, value: number): void {
        applyParams(this.node, this.deviceType, { [name]: value });
    }

    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null {
        // The curve resolver answers first: a parameter with no AudioParam has no
        // entry in the parameter table, so asking the table first would report it
        // unbound and the lane would be dropped.
        const curveTargets = resolveDeviceCurveWriteTargets(this.deviceType, parameterId, this.node);
        if (curveTargets) {
            return { kind: 'curveWrite', targets: curveTargets };
        }
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
