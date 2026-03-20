/**
 * Plugin Hosting Infrastructure.
 * Stubs for native plugin GUI hosting, sandboxing,
 * oversampling, and ARA2 integration.
 */

export type PluginWindow = {
    id: string;
    pluginId: string;
    width: number;
    height: number;
    x: number;
    y: number;
    visible: boolean;
};

export type OversamplingConfig = {
    pluginId: string;
    factor: 1 | 2 | 4;
    enabled: boolean;
};

const pluginWindows = new Map<string, PluginWindow>();
const oversamplingConfigs = new Map<string, OversamplingConfig>();

// ─── Plugin GUI Hosting ───────────────────────────────

/**
 * Open a floating window for a native plugin's GUI.
 * In production, uses Tauri `raw-window-handle` to create
 * a native OS window for the plugin to render into.
 */
export function openPluginGUI(pluginId: string, width = 800, height = 600): PluginWindow {
    const win: PluginWindow = {
        id: `plugin-win-${crypto.randomUUID().slice(0, 8)}`,
        pluginId,
        width,
        height,
        x: 100 + pluginWindows.size * 30,
        y: 100 + pluginWindows.size * 30,
        visible: true,
    };
    pluginWindows.set(win.id, win);
    return win;
}

export function closePluginGUI(windowId: string): void {
    pluginWindows.delete(windowId);
}

export function getOpenPluginWindows(): PluginWindow[] {
    return [...pluginWindows.values()];
}

// ─── Plugin Sandboxing ────────────────────────────────

export type SandboxProcess = {
    id: string;
    pluginId: string;
    pid: number;
    alive: boolean;
};

const sandboxProcesses = new Map<string, SandboxProcess>();

/**
 * Launch a plugin in a sandboxed out-of-process host.
 * Prevents plugin crashes from taking down the DAW.
 */
export function launchSandboxedPlugin(pluginId: string): SandboxProcess {
    const proc: SandboxProcess = {
        id: `sandbox-${crypto.randomUUID().slice(0, 8)}`,
        pluginId,
        pid: Math.floor(Math.random() * 65536), // Stub PID
        alive: true,
    };
    sandboxProcesses.set(proc.id, proc);
    return proc;
}

export function terminateSandboxedPlugin(processId: string): void {
    const proc = sandboxProcesses.get(processId);
    if (proc) {
        proc.alive = false;
    }
}

export function getSandboxedPlugins(): SandboxProcess[] {
    return [...sandboxProcesses.values()].filter((p) => p.alive);
}

// ─── Oversampling ─────────────────────────────────────

/**
 * Configure oversampling for a plugin.
 */
export function setOversampling(pluginId: string, factor: 1 | 2 | 4): void {
    oversamplingConfigs.set(pluginId, { pluginId, factor, enabled: factor > 1 });
}

export function getOversampling(pluginId: string): OversamplingConfig {
    return oversamplingConfigs.get(pluginId) ?? { pluginId, factor: 1, enabled: false };
}

// ─── ARA2 Integration ─────────────────────────────────

export type ARA2Extension = {
    pluginId: string;
    name: string;
    capabilities: ('pitch-correction' | 'time-stretch' | 'spectral-repair')[];
};

const araExtensions = new Map<string, ARA2Extension>();

/**
 * Register an ARA2 plugin extension.
 */
export function registerARA2Extension(
    pluginId: string,
    name: string,
    capabilities: ARA2Extension['capabilities']
): void {
    araExtensions.set(pluginId, { pluginId, name, capabilities });
}

/**
 * Get available ARA2 extensions.
 */
export function getARA2Extensions(): ARA2Extension[] {
    return [...araExtensions.values()];
}
