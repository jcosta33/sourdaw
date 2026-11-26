import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { writeToasterParamsNatively } from '../writeToasterParamsNatively';

import { type ToasterStripDeviceNode } from './findToasterNodeOnStrip';

type NativeTarget =
    | { kind: 'addressed' }
    | { kind: 'captured'; write: ((values: Readonly<Record<string, number>>) => void) | null };

/** Write a kit scalar to its selected runtime carriers without changing project state. */
export function writeToasterKitScalar(input: {
    trackId: string;
    deviceId: string;
    controls: ToasterStripDeviceNode['toasterControls'] | null;
    name: string;
    value: number;
    native: NativeTarget;
}): void {
    const { trackId, deviceId, controls, name, value, native } = input;
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible' || target.trackId !== trackId) return;
    controls?.setParam(name, value);
    if (native.kind === 'captured') {
        native.write?.({ [name]: value });
        return;
    }
    writeToasterParamsNatively({
        trackId,
        deviceId,
        messages: [{ type: 'param', name, value }],
    });
}
