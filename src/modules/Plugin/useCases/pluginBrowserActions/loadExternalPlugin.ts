import { addExternalDevice } from '#/modules/Arrangement/useCases';

/** Add an external plugin device to a track. */
export function loadExternalPlugin(trackId: string, pluginId: string, pluginName: string): void {
    addExternalDevice(trackId, pluginId, pluginName);
}