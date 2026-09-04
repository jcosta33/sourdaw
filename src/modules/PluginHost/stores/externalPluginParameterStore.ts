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

/**
 * Record that the engine has taken an instance that was loaded without one.
 *
 * Only the attachment fact moves. The parameters were published at activation —
 * the plugin declared them whether or not an engine was there to render it — and
 * replacing them here would drop settings a plugin-side edit has since recorded.
 *
 * An instance with no snapshot is not created, for the same reason
 * `patchExternalPluginParameters` does not create one: it was never activated in
 * this generation, and a snapshot with no parameter list offers an empty
 * automation menu that reads as a plugin with no controls.
 */
export function markExternalPluginParameterSnapshotAttached(instanceId: string): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const snapshot = current.byInstanceId[instanceId];
        if (!snapshot || snapshot.engineAttached) {
            return current;
        }
        return {
            ...current,
            byInstanceId: { ...current.byInstanceId, [instanceId]: { ...snapshot, engineAttached: true } },
        };
    });
}

/**
 * Retract the attachment of one instance the engine is about to lose.
 *
 * The mirror is read to decide whether a live strip may claim a native body for
 * an external plugin, and the native mapper refuses the *whole batch* over a
 * device whose instance it cannot find. So the retraction has to lead the
 * unload rather than follow it: between the native side dropping an instance
 * and this process hearing about it, a play that still read `engineAttached`
 * would build a strip the engine cannot map. Under-reporting is the safe
 * direction — the strip degrades, the session stands.
 *
 * Only the attachment fact moves. The parameters stay for the same reason
 * {@link markExternalPluginParameterSnapshotAttached} leaves them: they describe
 * the plugin, not the engine behind it, and the unload drops the whole snapshot
 * anyway once it lands.
 */
export function markExternalPluginParameterSnapshotDetached(instanceId: string): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const snapshot = current.byInstanceId[instanceId];
        if (!snapshot || !snapshot.engineAttached) {
            return current;
        }
        return {
            ...current,
            byInstanceId: { ...current.byInstanceId, [instanceId]: { ...snapshot, engineAttached: false } },
        };
    });
}

/**
 * Retract every attachment this process is mirroring.
 *
 * The unkeyed unload names no instance, so it retires all of them; anything
 * left claiming an engine after it would be claiming one for an instance that
 * is gone.
 */
export function markEveryExternalPluginParameterSnapshotDetached(): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        return {
            ...current,
            byInstanceId: Object.fromEntries(
                Object.entries(current.byInstanceId).map(([instanceId, snapshot]) => [
                    instanceId,
                    { ...snapshot, engineAttached: false },
                ])
            ),
        };
    });
}

/**
 * Record the setting a plugin reported for one of its own parameters.
 *
 * Only the value moves: a plugin-side edit says what the control is now set to
 * and nothing about its name, range or automatability, so patching the rest from
 * here would be describing a contract the plugin never re-declared — that is
 * what `patchExternalPluginParameters` is for, after a rescan.
 *
 * An unknown instance or parameter is ignored rather than created. A value with
 * no contract behind it has no range to be read against, and inventing one would
 * put a control in the automation menu the plugin never offered.
 */
export function patchExternalPluginParameterValue(instanceId: string, parameterId: number, value: number): void {
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const snapshot = current.byInstanceId[instanceId];
        if (!snapshot) {
            return current;
        }
        if (!snapshot.parameters.some((parameter) => parameter.id === parameterId)) {
            return current;
        }
        const parameters = snapshot.parameters.map((parameter) =>
            parameter.id === parameterId ? { ...parameter, value } : parameter
        );
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
