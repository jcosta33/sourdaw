import { createStore } from '#/infra/store/createStore';

/**
 * The failed-restore marker set itself is runtime isolation state in plain
 * module memory (`externalPluginRestoreFailures`), so UI reading the marker
 * predicate has nothing to subscribe to. This store carries only a version
 * that bumps on every mark and clear, giving subscribers a render signal; the
 * predicate stays the single source of truth for which instances fail.
 */
export type ExternalPluginRestoreFailureState = {
    version: number;
};

export const defaultExternalPluginRestoreFailureState: ExternalPluginRestoreFailureState = {
    version: 0,
};

export const externalPluginRestoreFailureStore = createStore<ExternalPluginRestoreFailureState>({
    initialData: defaultExternalPluginRestoreFailureState,
});

/**
 * Signal subscribers that the marker set changed. Writers stay inside
 * PluginHost — only the mark and clear use cases call this, so the module
 * keeps ownership of when failures begin and resolve.
 */
export function notifyExternalPluginRestoreFailuresChanged(): void {
    externalPluginRestoreFailureStore.update((state) => ({
        version: (state ?? defaultExternalPluginRestoreFailureState).version + 1,
    }));
}
