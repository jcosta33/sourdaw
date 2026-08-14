import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../stores/trackStore';
import { getPlatformPlugins } from '../useCases/getPlatformPlugins';

export function projectTrackThroughPriorBatchActions(track: Track, context: HandlerValidationContext): Track {
    const projected = structuredClone(track);
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.payload && 'trackId' in action.payload && action.payload.trackId !== projected.id) {
            continue;
        }
        if (action.type === 'addDevice') {
            if (!action.payload.deviceId) {
                continue;
            }
            const plugin = getPlatformPlugins().find(
                (candidate) =>
                    candidate.id === action.payload.deviceType ||
                    candidate.name.toLowerCase() === action.payload.deviceType.toLowerCase()
            );
            const parameterValues = { ...(plugin?.internalParameterValues ?? {}) };
            for (const parameter of plugin?.parameters ?? []) {
                parameterValues[parameter.id] = parameter.value;
            }
            const device = {
                id: action.payload.deviceId,
                name: plugin?.name ?? action.payload.deviceType,
                type: plugin?.id ?? action.payload.deviceType,
                bypassed: false,
                parameterValues,
            };
            const anchorIndex = action.payload.afterDeviceId
                ? projected.devices.findIndex((candidate) => candidate.id === action.payload.afterDeviceId)
                : projected.devices.length - 1;
            projected.devices.splice(anchorIndex + 1, 0, device);
            continue;
        }
        if (action.type === 'setTrackGain') {
            projected.gain = action.payload.gain;
        } else if (action.type === 'renameTrack') {
            projected.name = action.payload.name;
        } else if (action.type === 'setTrackPan') {
            projected.pan = action.payload.pan;
        } else if (action.type === 'muteTrack') {
            projected.muted = action.payload.muted;
        } else if (action.type === 'setTrackOutput') {
            projected.outputId = action.payload.outputId;
        } else if (action.type === 'addSend') {
            projected.sends.push({
                busId: action.payload.busId,
                level: action.payload.level,
                preFader: action.payload.preFader ?? false,
            });
        } else if (action.type === 'removeSend') {
            projected.sends = projected.sends.filter((send) => send.busId !== action.payload.busId);
        } else if (action.type === 'removeDevice') {
            projected.devices = projected.devices.filter((device) => device.id !== action.payload.deviceId);
        } else if (action.type === 'restoreDevice') {
            projected.devices.splice(action.payload.deviceIndex, 0, structuredClone(action.payload.deviceSnapshot));
        } else if (action.type === 'setDeviceParameter') {
            const device = projected.devices.find((candidate) => candidate.id === action.payload.deviceId);
            if (device) {
                if (action.payload.deleteParameter) {
                    delete device.parameterValues[action.payload.paramId];
                } else {
                    device.parameterValues[action.payload.paramId] = action.payload.value;
                }
            }
        }
    }
    return projected;
}
