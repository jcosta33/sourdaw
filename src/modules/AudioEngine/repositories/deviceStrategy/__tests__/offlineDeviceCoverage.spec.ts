import { beforeAll, describe, expect, it } from 'vitest';

import { getPlatformPlugins } from '#/modules/Arrangement/useCases';
import {
    compileFaustDSP,
    createFaustNode,
    isFaustModule,
    registerBuiltinFaustDSP,
    registerProModulationEffects,
} from '#/modules/PluginHost/useCases';

import { type Device } from '../../../models/TrackViewTypes';
import { createFaustDevice } from '../../faustDeviceFactory';
import { isNodelessOfflineDeviceType } from '../nodelessOfflineDeviceTypes';
import { createDeviceRegistry } from '../setupDeviceStrategies';
import { UNRENDERABLE_CATALOG_DEVICE_TYPES } from '../unrenderableCatalogDeviceTypes';
import { isUnsupportedDeviceTypeError } from '../unsupportedDeviceTypeError';

/**
 * Every device the catalog offers must have *some* offline render path, and
 * this guard proves it by building each one for real.
 *
 * It replaces a hardcoded list of eleven native device types that was checked
 * against the registries' own matchers. That guard asked "does a factory claim
 * this type" and never "does the result work", so it stayed green while
 * `builtin-crumbs` and `crust` had no offline implementation at all. Its list
 * was also a third hand-maintained thing: a new device could be added to the
 * product without ever touching it.
 *
 * The two sides here cannot converge by editing one of them:
 *
 * - The left side is `getPlatformPlugins()`, what the Content Browser and the
 *   mixer's device menu offer the user. It is authored for a user-visible
 *   feature by unrelated work; nobody edits it to make a test pass, and adding
 *   a device to the product necessarily adds it there.
 * - The right side is the real offline `DeviceFactoryRegistry`, exercised by
 *   actually calling `createDevice`. Nothing is asserted about matchers.
 *
 * The catalog is read under a stubbed native runtime, because that is the
 * runtime on which every entry is offered. Reading the web subset instead would
 * let `platform: 'native'` on a descriptor silently shrink this guard — and the
 * offline renderer is the same code on both platforms, so a native-only device
 * that cannot be rendered is just as broken.
 *
 * Only `UnsupportedDeviceTypeError` fails a case. Environment failures — jsdom
 * having no `createBiquadFilter`, WASM assets not fetchable under Node, Faust
 * unable to compile here — are exactly the class the export is allowed to
 * degrade past, and they must not be able to make this guard flaky either.
 */

/**
 * Catalog ids with no offline render path, read from the production table that
 * `buildDeviceChain` gates its refusal on. It is deliberately the same object
 * rather than a copy: the runtime decision and this guard must be the same
 * claim, and a second list would be free to drift from the first.
 *
 * An entry there is a declared defect, not a dispensation — the export fails
 * outright when one of these reaches a track, so the user is told rather than
 * handed a file missing the device. This suite pins the table from both sides:
 * an id that *gains* an implementation fails here until its entry is removed,
 * and any catalog id *missing* from it must build for real.
 */
const NO_OFFLINE_IMPLEMENTATION = UNRENDERABLE_CATALOG_DEVICE_TYPES;

/**
 * The whole catalog: `getPlatformPlugins` hides `platform: 'native'` entries
 * from a browser build, and the native runtime is the superset. Read here at
 * module scope so the case tables below are built from real product data.
 */
function readFullDeviceCatalog(): string[] {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    try {
        return getPlatformPlugins().map((descriptor) => descriptor.id);
    } finally {
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    }
}

const CATALOG_IDS = readFullDeviceCatalog();

const CHAIN_RENDERED_IDS = CATALOG_IDS.filter(
    (id) => !isNodelessOfflineDeviceType(id) && NO_OFFLINE_IMPLEMENTATION[id] === undefined
);

function buildOfflineRegistry() {
    return createDeviceRegistry({
        faustModuleMatcher: isFaustModule,
        createFaustDevice: ({ ctx, faustModuleId }) =>
            createFaustDevice({ ctx, faustModuleId, compileFaustDSP, createFaustNode }),
    });
}

function makeCatalogDevice(deviceType: string): Device {
    return { id: `probe-${deviceType}`, name: deviceType, type: deviceType, bypassed: false, parameterValues: {} };
}

/** The `UnsupportedDeviceTypeError` this device type raises, or null. */
async function coverageFailureFor(deviceType: string): Promise<unknown> {
    const registry = buildOfflineRegistry();
    const ctx = new OfflineAudioContext(2, 128, 48_000);
    try {
        await registry.createDevice(ctx, makeCatalogDevice(deviceType));
        return null;
    } catch (error) {
        if (isUnsupportedDeviceTypeError(error)) {
            return error;
        }
        return null;
    }
}

describe('offline device coverage', () => {
    beforeAll(() => {
        // `initializeAudioEngine` registers these at startup, and the Faust
        // matcher reads that runtime state. Priming it the way the app does
        // keeps the Faust half of the catalog a real check instead of an
        // exemption for a registry that simply had not been populated yet.
        registerBuiltinFaustDSP();
        registerProModulationEffects();
    });

    it('has catalog entries to check, so an empty left side cannot pass vacuously', () => {
        expect(CHAIN_RENDERED_IDS.length).toBeGreaterThan(30);
    });

    it.each(CHAIN_RENDERED_IDS)('builds %s through the offline device registry', async (deviceType) => {
        const failure = await coverageFailureFor(deviceType);

        expect(failure).toBeNull();
    });

    it.each(Object.keys(NO_OFFLINE_IMPLEMENTATION))(
        '%s is still unrenderable offline — remove its exemption once it is implemented',
        async (deviceType) => {
            const failure = await coverageFailureFor(deviceType);

            expect(isUnsupportedDeviceTypeError(failure)).toBe(true);
            expect((failure as Error).message).toContain(deviceType);
        }
    );

    it.each(Object.keys(NO_OFFLINE_IMPLEMENTATION))('%s is a real catalog id, not a stale string', (deviceType) => {
        expect(CATALOG_IDS).toContain(deviceType);
    });

    it('exempts no device that another offline path already renders', () => {
        const doubleClaimed = Object.keys(NO_OFFLINE_IMPLEMENTATION).filter((id) => isNodelessOfflineDeviceType(id));

        expect(doubleClaimed).toEqual([]);
    });
});
