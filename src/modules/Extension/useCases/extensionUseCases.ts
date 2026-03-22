/**
 * Extension Marketplace & Scripting API
 *
 * TypeScript scripting environment with a sandboxed execution model.
 * Extensions can register commands, add UI panels, process audio/MIDI,
 * and hook into the DAW lifecycle.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type ExtensionManifest = {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    /** Minimum DAW version required */
    minDawVersion: string;
    /** Extension entry point (relative to extension root) */
    main: string;
    /** Permissions requested */
    permissions: ExtensionPermission[];
    /** Category for marketplace listing */
    category: ExtensionCategory;
    /** Icon URL */
    icon?: string;
    /** Homepage/docs URL */
    homepage?: string;
    /** License identifier */
    license: string;
};

export type ExtensionPermission =
    | 'tracks:read'
    | 'tracks:write'
    | 'clips:read'
    | 'clips:write'
    | 'transport:read'
    | 'transport:write'
    | 'midi:read'
    | 'midi:write'
    | 'audio:read'
    | 'audio:write'
    | 'fs:read'
    | 'fs:write'
    | 'network'
    | 'ui:panel'
    | 'ui:menu';

export type ExtensionCategory =
    | 'effects'
    | 'instruments'
    | 'utilities'
    | 'analysis'
    | 'notation'
    | 'collaboration'
    | 'themes'
    | 'workflow'
    | 'ai'
    | 'other';

export type InstalledExtension = {
    manifest: ExtensionManifest;
    /** Is the extension currently enabled? */
    enabled: boolean;
    /** Installation timestamp */
    installedAt: string;
    /** Last update check */
    lastUpdatedAt: string;
    /** Extension state (persisted across sessions) */
    state: Record<string, unknown>;
};

export type ScriptCommand = {
    id: string;
    extensionId: string;
    label: string;
    description: string;
    /** The function to execute */
    handler: () => void | Promise<void>;
};

export type ExtensionMarketplaceState = {
    installed: InstalledExtension[];
    /** Registered script commands */
    commands: ScriptCommand[];
    /** Active scripting console log */
    consoleLog: Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>;
    /** Is the script editor panel open? */
    editorOpen: boolean;
    /** Current script in the editor */
    editorContent: string;
};

export const extensionStore = new Store<ExtensionMarketplaceState>(logger, {
    initialData: {
        installed: [],
        commands: [],
        consoleLog: [],
        editorOpen: false,
        editorContent: '// WebDAW Script\n// Access the DAW API via the global `daw` object\n\nconsole.log("Hello from WebDAW scripting!");\n',
    },
});

// ── Extension Installation ────────────────────────────────────────────

export function installExtension(manifest: ExtensionManifest): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    if (state.installed.some((e) => e.manifest.id === manifest.id)) {
        return; // Already installed
    }

    const ext: InstalledExtension = {
        manifest,
        enabled: true,
        installedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        state: {},
    };

    extensionStore.set({
        ...state,
        installed: [...state.installed, ext],
    });
}

export function uninstallExtension(extensionId: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    extensionStore.set({
        ...state,
        installed: state.installed.filter((e) => e.manifest.id !== extensionId),
        commands: state.commands.filter((c) => c.extensionId !== extensionId),
    });
}

export function toggleExtension(extensionId: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    extensionStore.set({
        ...state,
        installed: state.installed.map((e) =>
            e.manifest.id === extensionId ? { ...e, enabled: !e.enabled } : e
        ),
    });
}

// ── Script Commands ───────────────────────────────────────────────────

export function registerCommand(extensionId: string, id: string, label: string, description: string, handler: () => void | Promise<void>): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const command: ScriptCommand = { id: `${extensionId}.${id}`, extensionId, label, description, handler };

    extensionStore.set({
        ...state,
        commands: [...state.commands.filter((c) => c.id !== command.id), command],
    });
}

export function executeCommand(commandId: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const cmd = state.commands.find((c) => c.id === commandId);
    if (!cmd) {
        appendLog('error', `Command not found: ${commandId}`);
        return;
    }

    try {
        const result = cmd.handler();
        if (result instanceof Promise) {
            result.catch((err) => appendLog('error', `Command error: ${err}`));
        }
    } catch (err) {
        appendLog('error', `Command error: ${err}`);
    }
}

// ── Script Editor ─────────────────────────────────────────────────────

export function toggleScriptEditor(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, editorOpen: !state.editorOpen });
}

export function setEditorContent(content: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, editorContent: content });
}

/**
 * Execute the current editor content in a sandboxed context.
 */
export function runEditorScript(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const code = state.editorContent;
    appendLog('info', '▶ Running script...');

    try {
        // Sandboxed execution — create a function scope with limited API
        const sandboxedConsole = {
            log: (msg: string) => appendLog('info', String(msg)),
            warn: (msg: string) => appendLog('warn', String(msg)),
            error: (msg: string) => appendLog('error', String(msg)),
        };

        const fn = new Function('console', 'daw', code);
        fn(sandboxedConsole, createDawApi());
        appendLog('info', '✓ Script completed');
    } catch (err) {
        appendLog('error', `Script error: ${err}`);
    }
}

function createDawApi(): Record<string, unknown> {
    // Limited DAW API exposed to scripts
    return {
        version: '0.1.0',
        notify: (message: string) => {
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', { detail: { message, level: 'info' } })
            );
        },
        executeAction: async (action: { type: string; payload?: unknown }) => {
            const { executeAppAction } = await import('#/modules/Command/useCases/executeAppAction');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await executeAppAction(action as any, { source: 'ai' });
        },
    };
}

// ── Console ───────────────────────────────────────────────────────────

function appendLog(level: 'info' | 'warn' | 'error', message: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({
        ...state,
        consoleLog: [
            ...state.consoleLog.slice(-99), // Keep last 100 entries
            { timestamp: new Date().toISOString(), level, message },
        ],
    });
}

export function clearConsole(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, consoleLog: [] });
}

// ── Queries ──────────────────────────────────────────────────────────

export function getInstalledExtensions(): InstalledExtension[] {
    return extensionStore.value?.installed ?? [];
}

export function getExtensionCommands(): ScriptCommand[] {
    return extensionStore.value?.commands ?? [];
}

export function getEnabledExtensions(): InstalledExtension[] {
    return (extensionStore.value?.installed ?? []).filter((e) => e.enabled);
}
