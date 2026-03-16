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

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI__" in window;

const tauriCorePath = "@tauri-apps/api/core";

const tauriInvoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    const mod = await import(/* @vite-ignore */ tauriCorePath) as {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    return mod.invoke(cmd, args);
};

export const scanPlugins = async (paths: string[]): Promise<ScanResult> => {
    if (!isTauri()) {
        return { plugins: [], errors: ["Plugin scanning requires the desktop app"], scan_duration_ms: 0 };
    }
    return tauriInvoke("scan_plugins", { paths }) as Promise<ScanResult>;
};

export const getDefaultPluginPaths = async (): Promise<string[]> => {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke("get_default_plugin_paths") as Promise<string[]>;
};

export const loadPlugin = async (pluginId: string, instanceId: string): Promise<PluginInstance> => {
    if (!isTauri()) {
        return {
            instance_id: instanceId,
            plugin_id: pluginId,
            name: "Unavailable",
            parameters: [],
            is_active: false,
            latency_samples: 0,
        };
    }
    return tauriInvoke("load_plugin", { pluginId, instanceId }) as Promise<PluginInstance>;
};

export const unloadPlugin = async (instanceId: string): Promise<void> => {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke("unload_plugin", { instanceId });
};

export const setPluginParameter = async (instanceId: string, paramId: number, value: number): Promise<void> => {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke("set_plugin_parameter", { instanceId, paramId, value });
};

export const getPluginParameters = async (instanceId: string): Promise<PluginParameter[]> => {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke("get_plugin_parameters", { instanceId }) as Promise<PluginParameter[]>;
};

export const getPluginState = async (instanceId: string): Promise<number[]> => {
    if (!isTauri()) {
        return [];
    }
    return tauriInvoke("get_plugin_state", { instanceId }) as Promise<number[]>;
};

export const setPluginState = async (instanceId: string, state: number[]): Promise<void> => {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke("set_plugin_state", { instanceId, state });
};

export const isTauriAvailable = isTauri;
