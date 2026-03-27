/**
 * Plugin lifecycle use cases — thin wrappers around repository functions
 * to provide a proper contract for cross-module consumers.
 */

import { loadPlugin as loadPluginRepo } from '../repositories/pluginBridge/loadPlugin';
import { unloadPlugin as unloadPluginRepo } from '../repositories/pluginBridge/unloadPlugin';
import { processAudioIPC as processAudioIPCRepo } from '../repositories/pluginBridge/processAudioIPC';
import { openPluginGui as openPluginGuiRepo } from '../repositories/pluginBridge/openPluginGui';
import { closePluginGui as closePluginGuiRepo } from '../repositories/pluginBridge/closePluginGui';

export type { PluginInstance, PluginGuiInfo } from '../repositories/pluginBridge/types';

/** Load a plugin instance by plugin ID and instance ID. */
export function loadPlugin(
    pluginId: string,
    instanceId: string
): ReturnType<typeof loadPluginRepo> {
    return loadPluginRepo(pluginId, instanceId);
}

/** Unload a plugin instance by its instance ID. */
export function unloadPlugin(
    instanceId: string
): ReturnType<typeof unloadPluginRepo> {
    return unloadPluginRepo(instanceId);
}

/**
 * Process an audio block through a plugin instance (IPC bridge).
 * Sends Float32Array to Rust and returns processed audio.
 */
export function processAudioIPC(
    instanceId: string,
    audioData: Float32Array
): ReturnType<typeof processAudioIPCRepo> {
    return processAudioIPCRepo(instanceId, audioData);
}

/** Open a plugin's GUI window. */
export function openPluginGui(
    instanceId: string
): ReturnType<typeof openPluginGuiRepo> {
    return openPluginGuiRepo(instanceId);
}

/** Close a plugin's GUI window. */
export function closePluginGui(
    instanceId: string
): ReturnType<typeof closePluginGuiRepo> {
    return closePluginGuiRepo(instanceId);
}
