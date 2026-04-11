/**
 * Plugin Browser Actions — local use cases wrapping cross-module Track calls
 * so that AudioEngine's PluginBrowser view doesn't import Track use cases directly.
 */

import { inject } from '#/infra/di/inject';
import { addExternalDevice, addTrack } from '#/modules/Arrangement/useCases';

type TrackInfo = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'group' | 'folder' | 'bus' | 'master';
};

export const pluginBrowserActionsDependencies = {
    addTrack,
    addExternalDevice,
} as const;

/** Create a new track for hosting a plugin. */
export const createTrackForPlugin = inject(pluginBrowserActionsDependencies)(
    ({ addTrack }) =>
        function createTrackForPlugin(name: string, kind: 'audio' | 'midi'): TrackInfo | null {
            return addTrack({ name, kind });
        }
);

/** Add an external plugin device to a track. */
export const loadExternalPlugin = inject(pluginBrowserActionsDependencies)(
    ({ addExternalDevice }) =>
        function loadExternalPlugin(trackId: string, pluginId: string, pluginName: string): void {
            addExternalDevice(trackId, pluginId, pluginName);
        }
);
