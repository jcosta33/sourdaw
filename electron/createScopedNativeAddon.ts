import { realpathSync } from 'node:fs';

import type { NativeAddon, NativeEventCallback, NativeHost } from './native.js';
import type { resolveRuntimeScope } from './runtimeScope.js';

type Scope = NonNullable<ReturnType<typeof resolveRuntimeScope>>;

const isHost = (value: unknown): value is NativeHost =>
    typeof value === 'object' &&
    value !== null &&
    [
        'shutdown',
        'grantPath',
        'beginRendererSession',
        'startDictation',
        'stopDictation',
        'cancelDictation',
        'runtimeScopeInfoV1',
    ].every((name) => typeof Reflect.get(value, name) === 'function');

/** Reject old addons before construction: their constructors may ignore extra arguments. */
export const createScopedNativeAddon = ({
    addon,
    scope,
    onEvent,
    requireExportState,
}: {
    readonly addon: NativeAddon;
    readonly scope: Scope | undefined;
    readonly onEvent: NativeEventCallback;
    readonly requireExportState: boolean;
}): NativeHost => {
    if (scope === undefined) {
        return new addon.SourdawNative(onEvent);
    }
    const factory: unknown = Reflect.get(addon.SourdawNative, 'withRuntimeScopeV1');
    const prototype: unknown = Reflect.get(addon.SourdawNative, 'prototype');
    if (
        typeof factory !== 'function' ||
        typeof prototype !== 'object' ||
        prototype === null ||
        typeof Reflect.get(prototype, 'runtimeScopeInfoV1') !== 'function'
    ) {
        throw new Error('The native addon does not support runtime scope V1');
    }
    const host: unknown = Reflect.apply(factory, addon.SourdawNative, [onEvent, scope.paths.root]);
    if (!isHost(host)) {
        throw new Error('The native runtime scope factory returned an invalid host');
    }
    const inspect = host.runtimeScopeInfoV1;
    if (inspect === undefined) {
        throw new Error('The native runtime scope receipt is unavailable');
    }
    const receipt: unknown = Reflect.apply(inspect, host, []);
    if (
        typeof receipt !== 'object' ||
        receipt === null ||
        Reflect.get(receipt, 'version') !== 1 ||
        typeof Reflect.get(receipt, 'exportStateAvailable') !== 'boolean'
    ) {
        throw new Error('The native runtime scope receipt is invalid');
    }
    for (const [key, expected] of Object.entries(scope.paths)) {
        const actual: unknown = Reflect.get(receipt, key);
        if (typeof actual !== 'string' || realpathSync(actual) !== realpathSync(expected)) {
            throw new Error(`The native runtime scope receipt mismatches ${key}`);
        }
    }
    if (requireExportState && Reflect.get(receipt, 'exportStateAvailable') !== true) {
        throw new Error('The native runtime scope export state is unavailable');
    }
    return host;
};
