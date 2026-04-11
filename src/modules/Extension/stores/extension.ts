/**
 * Extension marketplace store — manages installed extensions,
 * script commands, console log, and editor state.
 *
 * TODO: FROZEN — Extension system is architecturally sound (types, manifest,
 * permissions model) but the runtime is unsandboxed. Do not build further
 * UI or expose to users until Worker-based sandbox is implemented.
 * Permissions below are declared but never enforced at runtime.
 * See `.agents/audits/webdaw-codebase-audit.md` → **Findings → Extension scripting (frozen)**.
 */

import { createStore } from '#/infra/store/createStore';

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

export const extensionStore = createStore<ExtensionMarketplaceState>({
    initialData: {
        installed: [],
        commands: [],
        consoleLog: [],
        editorOpen: false,
        editorContent:
            '// Sourdaw Script\n// Access the DAW API via the global `daw` object\n\nconsole.log("Hello from Sourdaw scripting!");\n',
    },
});
