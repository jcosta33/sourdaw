import { createStore } from '#/infra/store/createStore';

/**
 * Whether one plugin instance's editor window is open, and why the last attempt
 * to open it failed.
 *
 * Held here rather than derived from a query because the window is not ours: the
 * OS can close it behind the app's back, and the native host reports that as an
 * event. A control that assumed an editor stayed open until the app closed it
 * would go on offering to close a window that is already gone.
 */
export type PluginGuiStatus = {
    isOpen: boolean;
    /**
     * The host's own refusal from the last failed open, kept so the rack can say
     * why instead of appearing to do nothing. Cleared by the next successful
     * open.
     */
    error?: string;
};

export type PluginGuiState = {
    byInstanceId: Record<string, PluginGuiStatus>;
};

export const defaultPluginGuiState: PluginGuiState = {
    byInstanceId: {},
};

export const pluginGuiStore = createStore<PluginGuiState>({
    initialData: defaultPluginGuiState,
});
