import { createStore } from '#/infra/store/createStore';
import { readLastAutomationWriteSequence } from '#/modules/Transport/stores';

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
        const entries = Object.entries(current.byInstanceId);
        if (!entries.some(([, snapshot]) => snapshot.engineAttached)) {
            return current;
        }
        return {
            ...current,
            byInstanceId: Object.fromEntries(
                entries.map(([instanceId, snapshot]) => [instanceId, { ...snapshot, engineAttached: false }])
            ),
        };
    });
}

/**
 * Put back the attachment of instances an unload retracted and then failed to
 * take.
 *
 * The retraction is optimistic — it has to lead the unload, because the window
 * between the native side dropping an instance and this process hearing about
 * it is one a play can land in. An unload that fails leaves the instance loaded
 * and attached, and nothing else ever revises this flag back: activation
 * short-circuits on an instance it already holds, and the engine reports only
 * the dormant instances a batch newly took. Left retracted, the plugin's
 * automation lanes stop riding the audible path and its parameters leave the
 * picker for the rest of the session.
 *
 * An id with no snapshot is skipped rather than created: that is how an unload
 * that took *some* of what it named restores only the rest, because a taken
 * instance's snapshot is already dropped.
 */
export function markExternalPluginParameterSnapshotsAttached(instanceIds: ReadonlySet<string>): void {
    if (instanceIds.size === 0) {
        return;
    }
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const restored = [...instanceIds].flatMap((instanceId) => {
            const snapshot = current.byInstanceId[instanceId];
            if (!snapshot || snapshot.engineAttached) {
                return [];
            }
            return [[instanceId, { ...snapshot, engineAttached: true }] as const];
        });
        if (restored.length === 0) {
            return current;
        }
        return { ...current, byInstanceId: { ...current.byInstanceId, ...Object.fromEntries(restored) } };
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
        bumpEditGeneration(instanceId, parameterId);
        return { ...current, byInstanceId: { ...current.byInstanceId, [instanceId]: { ...snapshot, parameters } } };
    });
}

/**
 * What a host re-read must not displace, captured when the read is issued: the
 * edits and the newer re-reads that land while the host is still answering, and
 * the scheduler write the answer cannot know about.
 */
export type ExternalPluginParameterReadTicket = {
    token: number;
    editGenerations: ReadonlyMap<number, number>;
    /** The scheduler's latest automation write sequence when the read was issued. */
    automationWriteSequence: number;
};

/** Per instance, how many value edits each parameter has taken; absent means none. */
const editGenerations = new Map<string, Map<number, number>>();
/** Per instance, the token of the newest re-read whose answer reached the store; an older one is dropped. */
const publishedReadToken = new Map<string, number>();
/** Global, so a token issued before an instance was dropped never matches one issued after. */
let lastReadToken = 0;
/** Which scheduler write was latest when the re-read that published a parameter object was issued. */
const readIssues = new WeakMap<object, number>();

function bumpEditGeneration(instanceId: string, parameterId: number): void {
    const generations = editGenerations.get(instanceId) ?? new Map<number, number>();
    generations.set(parameterId, (generations.get(parameterId) ?? 0) + 1);
    editGenerations.set(instanceId, generations);
}

export function issueExternalPluginParameterRead(instanceId: string): ExternalPluginParameterReadTicket {
    lastReadToken += 1;
    return {
        token: lastReadToken,
        editGenerations: new Map(editGenerations.get(instanceId)),
        automationWriteSequence: readLastAutomationWriteSequence(),
    };
}

/**
 * The scheduler write that was latest when the re-read that put `parameter` in the store was issued, or
 * `undefined` for an object no re-read published (an edit's patch, or the activation snapshot). A re-read
 * issued before a write says nothing about that write, so a reader following automation can tell a stale
 * answer from news.
 */
export function readExternalPluginParameterReadIssue(parameter: object): number | undefined {
    return readIssues.get(parameter);
}

/**
 * Publish a host answer unless a newer re-read's answer has already been
 * published (an answer superseded by one that then failed still publishes), and
 * keep the store's own object for every parameter edited since the ticket: the
 * host answered before that edit, so its value is the older one. Returns the
 * parameter objects this call put in the store, each tagged with the write
 * sequence captured at issue (see {@link readExternalPluginParameterReadIssue}).
 * An instance with no snapshot publishes nothing.
 */
export function publishExternalPluginParameterRead(
    instanceId: string,
    ticket: ExternalPluginParameterReadTicket,
    hostParameters: readonly ExternalPluginParameter[]
): readonly ExternalPluginParameter[] {
    if (ticket.token < (publishedReadToken.get(instanceId) ?? 0)) {
        return [];
    }
    let published: readonly ExternalPluginParameter[] = [];
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const snapshot = current.byInstanceId[instanceId];
        if (!snapshot) {
            return current;
        }
        const generations = editGenerations.get(instanceId);
        const edited = new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter]));
        const merged = hostParameters.map((parameter) =>
            (generations?.get(parameter.id) ?? 0) === (ticket.editGenerations.get(parameter.id) ?? 0)
                ? parameter
                : (edited.get(parameter.id) ?? parameter)
        );
        const fromHost = new Set(hostParameters);
        published = merged.filter((parameter) => fromHost.has(parameter));
        for (const parameter of published) {
            readIssues.set(parameter, ticket.automationWriteSequence);
        }
        publishedReadToken.set(instanceId, ticket.token);
        return {
            ...current,
            byInstanceId: { ...current.byInstanceId, [instanceId]: { ...snapshot, parameters: merged } },
        };
    });
    return published;
}

/** Forget the read bookkeeping of every instance, with the snapshots that owned it. */
export function clearExternalPluginParameterReadState(): void {
    editGenerations.clear();
    publishedReadToken.clear();
}

export function dropExternalPluginParameterSnapshot(instanceId: string): void {
    editGenerations.delete(instanceId);
    publishedReadToken.delete(instanceId);
    externalPluginParameterStore.update((state) => {
        const current = state ?? defaultExternalPluginParameterState;
        const byInstanceId = { ...current.byInstanceId };
        delete byInstanceId[instanceId];
        return { ...current, byInstanceId };
    });
}
