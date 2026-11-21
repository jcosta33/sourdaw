import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { deviceChainProjectorByActionType } from './DeviceChainProjectorByActionType';
import { type PluginDescriptor } from './DeviceParameterTypes';
import { type Device } from './Track';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function lookup<Type extends AppActionType>(
    action: ActionOf<Type>,
    source: readonly Device[],
    plugins: readonly PluginDescriptor[]
): Device[] | null {
    if (!Object.hasOwn(deviceChainProjectorByActionType, action.type)) {
        return null;
    }
    const project = deviceChainProjectorByActionType[action.type];
    if (!project) {
        return null;
    }
    return project(
        action,
        source.map((device) => structuredClone(device)),
        plugins
    );
}

/** Shared owner projection of the existing device-chain command rules; never writes a store. */
export function projectDeviceChainAction(
    trackId: string,
    source: readonly Device[],
    action: AppAction,
    plugins: readonly PluginDescriptor[]
): Device[] | null {
    if (action.payload && 'trackId' in action.payload && action.payload.trackId !== trackId) {
        return null;
    }
    return lookup(action, source, plugins);
}
