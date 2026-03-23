export type ScannedPlugin = {
    id: string;
    name: string;
    vendor: string;
    format: string;
    category: string;
    path: string;
    version: string;
    num_inputs: number;
    num_outputs: number;
    num_parameters: number;
    has_custom_ui: boolean;
};

export type PluginParameter = {
    id: number;
    name: string;
    value: number;
    default_value: number;
    min_value: number;
    max_value: number;
    unit: string;
    is_automatable: boolean;
};

export type PluginInstance = {
    instance_id: string;
    plugin_id: string;
    name: string;
    parameters: PluginParameter[];
    is_active: boolean;
    latency_samples: number;
};

export type ScanResult = {
    plugins: ScannedPlugin[];
    errors: string[];
    scan_duration_ms: number;
};

import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';

export async function scanPlugins(paths: string[]): Promise<ScanResult> {
    if (!isTauri()) {
        return { plugins: [], errors: ['Plugin scanning requires the desktop app'], scan_duration_ms: 0 };
    }
    return tauriInvoke('scan_plugins', { paths }) as Promise<ScanResult>;
}

export async function getDefaultPluginPaths(): Promise<string[]> {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke('get_default_plugin_paths') as Promise<string[]>;
}

export async function loadPlugin(pluginId: string, instanceId: string): Promise<PluginInstance> {
    if (!isTauri()) {
        return {
            instance_id: instanceId,
            plugin_id: pluginId,
            name: 'Unavailable',
            parameters: [],
            is_active: false,
            latency_samples: 0,
        };
    }
    return tauriInvoke('load_plugin', { pluginId, instanceId }) as Promise<PluginInstance>;
}

export async function unloadPlugin(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('unload_plugin', { instanceId });
}

export async function setPluginParameter(instanceId: string, paramId: number, value: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_parameter', { instanceId, paramId, value });
}

export async function getPluginParameters(instanceId: string): Promise<PluginParameter[]> {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke('get_plugin_parameters', { instanceId }) as Promise<PluginParameter[]>;
}

export async function getPluginState(instanceId: string): Promise<number[]> {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke('get_plugin_state', { instanceId }) as Promise<number[]>;
}

export async function setPluginState(instanceId: string, state: number[]): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_plugin_state', { instanceId, state });
}

/**
 * Handles the raw Float32Array crossing from the AudioWorklet to Rust and back.
 * Bypasses JSON entirely to use binary payloads on the Tauri custom protocol.
 */
export async function processAudioIPC(instanceId: string, audioData: Float32Array): Promise<Float32Array> {
    if (!isTauri()) {
        return audioData;
    }

    try {
        // Note: Tauri v2 IPC allows us to pass Uint8Array bodies natively
        // Here we cast Float32Array -> Uint8Array to send to Rust
        const bodyArray = new Uint8Array(audioData.buffer);

        const responseArray = (await tauriInvoke('audio_ipc', {
            instanceId,
            body: Array.from(bodyArray),
        })) as number[];

        // Reconstitute back from Rust
        return new Float32Array(new Uint8Array(responseArray).buffer);
    } catch (error) {
        console.error('Audio IPC failed', error);
        return audioData;
    }
}

// ── Plugin GUI ──────────────────────────────────────────────────────────

export type PluginGuiInfo = {
    has_gui: boolean;
    is_open: boolean;
    width: number;
    height: number;
};

export async function isPluginGuiSupported(instanceId: string): Promise<boolean> {
    if (!isTauri()) {
        return false;
    }
    return tauriInvoke('is_plugin_gui_supported', { instanceId }) as Promise<boolean>;
}

export async function openPluginGui(instanceId: string): Promise<PluginGuiInfo> {
    if (!isTauri()) {
        return { has_gui: false, is_open: false, width: 0, height: 0 };
    }
    return tauriInvoke('open_plugin_gui', { instanceId }) as Promise<PluginGuiInfo>;
}

export async function closePluginGui(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('close_plugin_gui', { instanceId });
}

export const isTauriAvailable = isTauri;
