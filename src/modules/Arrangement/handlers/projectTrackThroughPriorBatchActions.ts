import { type HandlerValidationContext } from '#/utils/handlerContract';

import { projectDeviceChainAction } from '../models/DeviceChainActionProjection';
import { type Track } from '../stores/trackStore';
import { getPlatformPlugins } from '../useCases/getPlatformPlugins';

import { projectTrackAction } from './projectTrackAction';

export function projectTrackThroughPriorBatchActions(track: Track, context: HandlerValidationContext): Track {
    const projected = structuredClone(track);
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.payload && 'trackId' in action.payload && action.payload.trackId !== projected.id) {
            continue;
        }
        const devices = projectDeviceChainAction(
            projected.id,
            projected.devices,
            action,
            action.type === 'addDevice' ? getPlatformPlugins() : []
        );
        if (devices !== null) {
            projected.devices = devices;
            continue;
        }
        projectTrackAction(projected, action);
    }
    return projected;
}
