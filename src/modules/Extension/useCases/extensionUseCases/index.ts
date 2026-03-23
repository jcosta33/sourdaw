// Types
export type {
    ExtensionManifest,
    ExtensionPermission,
    ExtensionCategory,
    InstalledExtension,
    ScriptCommand,
    ExtensionMarketplaceState,
} from '#/modules/Extension/stores/extension';
export { extensionStore } from '#/modules/Extension/stores/extension';

// Extension installation
export { installExtension } from './installExtension';
export { uninstallExtension } from './uninstallExtension';
export { toggleExtension } from './toggleExtension';

// Script commands
export { registerCommand } from './registerCommand';
export { executeCommand } from './executeCommand';

// Script editor
export { toggleScriptEditor } from './toggleScriptEditor';
export { setEditorContent } from './setEditorContent';
export { runEditorScript } from './runEditorScript';

// Console
export { clearConsole } from './clearConsole';

// Queries
export { getInstalledExtensions } from './getInstalledExtensions';
export { getExtensionCommands } from './getExtensionCommands';
export { getEnabledExtensions } from './getEnabledExtensions';
