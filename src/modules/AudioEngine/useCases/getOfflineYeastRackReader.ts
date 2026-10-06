import { offlineRenderCapturePorts } from './offlineRender/offlineRenderCapturePorts';

/**
 * The Yeast owner's rack reads the composition root configured for offline capture, or `null`
 * when none is configured. A caller comparing a captured document's racks reads them here rather
 * than importing the Yeast store, whose module subscribes to the track store when it loads.
 */
export function getOfflineYeastRackReader() {
    return offlineRenderCapturePorts.yeastRacks;
}
