import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';
import { writeNativeBuiltinParameters } from './writeNativeBuiltinParameters';
import { writeWebDeviceParam } from './writeWebDeviceParam';

/** Apply ordered project parameters to Web Audio and send one batch to the carried native body. */
export function updateDeviceParameters(
    trackId: string,
    deviceId: string,
    parameters: readonly (readonly [paramId: string, value: number])[]
): void {
    if (parameters.length === 0) {
        return;
    }
    const clamped: [string, number][] = [];
    for (const [paramId, value] of parameters) {
        clamped.push([paramId, writeWebDeviceParam(trackId, deviceId, paramId, value)]);
    }
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        const values = Object.fromEntries(clamped.map(([paramId, value]) => [body.parameterName(paramId), value]));
        writeNativeBuiltinParameters(trackId, deviceId, values);
    }
}
