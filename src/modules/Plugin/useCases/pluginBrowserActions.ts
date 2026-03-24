/**
 * Plugin Browser Actions — local use cases wrapping cross-module Track calls
 * so that AudioEngine's PluginBrowser view doesn't import Track use cases directly.
 */

import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { addExternalDevice } from '#/modules/Arrangement/useCases/deviceUseCases';

type TrackInfo = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'group' | 'folder' | 'bus' | 'master';
};

/** Create a new track for hosting a plugin. */
export function createTrackForPlugin(name: string, kind: 'audio' | 'midi'): TrackInfo | null {
    return addTrack({ name, kind });
}

/** Add an external plugin device to a track. */
export function loadExternalPlugin(trackId: string, pluginId: string, pluginName: string): void {
    addExternalDevice(trackId, pluginId, pluginName);
}
