import { nativeBuiltinBody } from '../livePlayback/nativeBuiltinBodies';

import { deviceTypeOnStrip } from './deviceTypeOnStrip';

export function deviceParameterRuntimeWriteParameterId(trackId: string, deviceId: string, paramId: string): string {
    const type = deviceTypeOnStrip(trackId, deviceId);
    return (type ? nativeBuiltinBody(type)?.parameterName(paramId) : undefined) ?? paramId;
}
