/**
 * Where each Crumbs device stands in creating its native instance (#4204).
 *
 * The panel has to tell a sampler that takes its writes from one that silently
 * drops them, and no other store can answer that. Instance state cannot:
 * `ensureCrumbsInstanceFromProject` seeds an entry from project truth on every
 * panel mount, so an entry exists whether or not a native instance was ever
 * created — including right after `syncCrumbsNativeInstances` rolled one back
 * because the native addon is absent. Reading readiness from that entry made
 * the panel report Ready while every parameter write no-opped.
 *
 * The attachment mirror cannot answer it either, and deliberately so: it holds
 * only instances the engine is rendering, and a created instance that no batch
 * has attached yet is dormant — it parks writes and `attach_dormant_crumbs`
 * takes it over later. Absent from the mirror therefore means "not yet", not
 * "not there". This store carries the fact the mirror leaves out: whether the
 * create itself succeeded.
 *
 * Only the sync writes it, because only the sync creates and destroys
 * instances. An entry is removed with the instance, so a device that is gone
 * has no state rather than a stale one.
 */

import { createStore } from '#/infra/store/createStore';

/**
 * - `creating`: the create round trip is in flight; nothing is decided.
 * - `bound`: the engine holds an instance for this device — attached, dormant,
 *   or already bound by another creator that refused this one as a duplicate.
 * - `failed`: the create failed and its instance state was rolled back, so
 *   there is no sampler behind this device at all.
 */
export type CrumbsNativeLifecycle = 'creating' | 'bound' | 'failed';

export const crumbsNativeLifecycleStore = createStore<Record<string, CrumbsNativeLifecycle>>({
    initialData: {},
});

export function readCrumbsNativeLifecycle(deviceId: string): CrumbsNativeLifecycle | undefined {
    return crumbsNativeLifecycleStore.value?.[deviceId];
}

function setLifecycle(deviceId: string, lifecycle: CrumbsNativeLifecycle): void {
    crumbsNativeLifecycleStore.update((current) => {
        if (current?.[deviceId] === lifecycle) {
            return current;
        }
        return { ...current, [deviceId]: lifecycle };
    });
}

export function markCrumbsInstanceCreating(deviceId: string): void {
    setLifecycle(deviceId, 'creating');
}

export function markCrumbsInstanceBound(deviceId: string): void {
    setLifecycle(deviceId, 'bound');
}

export function markCrumbsInstanceFailed(deviceId: string): void {
    setLifecycle(deviceId, 'failed');
}

export function forgetCrumbsInstanceLifecycle(deviceId: string): void {
    crumbsNativeLifecycleStore.update((current) => {
        if (current?.[deviceId] === undefined) {
            return current ?? {};
        }
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== deviceId));
    });
}
