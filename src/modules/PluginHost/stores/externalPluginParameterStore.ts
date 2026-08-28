import { createStore } from '#/infra/store/createStore';

/**
 * One automatable control an external plugin instance reports about itself.
 *
 * The native host answers `get_plugin_parameters` with a snake_case DTO; this is
 * the camelCase read contract other modules see, so the wire shape stays inside
 * `repositories/pluginBridge`.
 */
export type ExternalPluginParameter = {
    /**
     * The plugin's own parameter id — a CLAP/VST3 `u32`, not an index into this
     * array. Every write addresses the parameter by this number, so it is the
     * identity an automation target has to carry.
     */
    id: number;
    name: string;
    /** The setting in force when the snapshot was taken. */
    value: number;
    defaultValue: number;
    minValue: number;
    maxValue: number;
    unit: string;
    /** The plugin's own declaration. A parameter it refuses to automate is never offered. */
    isAutomatable: boolean;
};

/**
 * What an external plugin instance currently offers, as far as this process
 * knows. Held rather than queried because the metadata arrives over async IPC
 * and every reader of it — the automation menu, lane range resolution — is
 * synchronous.
 */
export type ExternalPluginParameterSnapshot = {
    /**
     * Whether the instance is attached to the native audio engine
     * (`PluginInstance.engine_plugin_id` is not `null`).
     *
     * A loaded-but-unattached instance is in no rendering graph, so a parameter
     * write reaches nothing. Recorded rather than assumed: offering automation
     * for it would promise a ride the engine never performs.
     */
    engineAttached: boolean;
    parameters: readonly ExternalPluginParameter[];
};

export type ExternalPluginParameterState = {
    byInstanceId: Record<string, ExternalPluginParameterSnapshot>;
};

export const defaultExternalPluginParameterState: ExternalPluginParameterState = {
    byInstanceId: {},
};

export const externalPluginParameterStore = createStore<ExternalPluginParameterState>({
    initialData: defaultExternalPluginParameterState,
});

/**
 * Writers are module-private: they are not on the `stores/` barrel, so foreign
 * modules read this store and never write it. Activation seeds a snapshot, a
 * refresh replaces its parameters, and unload drops it.
 */

export function writeExternalPluginParameterSnapshot(
    instanceId: string,
    snapshot: ExternalPluginParameterSnapshot
): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        return { ...current, byInstanceId: { ...current.byInstanceId, [instanceId]: snapshot } };
    });
}

/**
 * Replace the parameters of a snapshot that already exists, keeping the
 * attachment fact recorded at activation — a refresh reads the plugin's
 * parameter list, which says nothing about whether the instance reached the
 * engine. An instance with no snapshot is not created here: it was never
 * activated in this generation, so claiming an attachment either way is a guess.
 */
export function patchExternalPluginParameters(
    instanceId: string,
    parameters: readonly ExternalPluginParameter[]
): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const snapshot = current.byInstanceId[instanceId];
        if (!snapshot) {
            return current;
        }
        return { ...current, byInstanceId: { ...current.byInstanceId, [instanceId]: { ...snapshot, parameters } } };
    });
}

export function dropExternalPluginParameterSnapshot(instanceId: string): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const byInstanceId = { ...current.byInstanceId };
        delete byInstanceId[instanceId];
        return { ...current, byInstanceId };
    });
}
