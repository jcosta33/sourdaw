import { beforeAll, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { getPlatformPlugins } from '#/modules/Arrangement/useCases';
import {
    compileFaustDSP,
    createFaustNode,
    isFaustInstrumentModule,
    isFaustModule,
    registerBuiltinFaustDSP,
    registerProModulationEffects,
} from '#/modules/PluginHost/useCases';
import { getSynthParamsFromDevices } from '#/modules/Synth/useCases';

import { findWasmDescriptor } from '../../../engine/wasmDeviceRegistry';
import { type Device } from '../../../models/TrackViewTypes';
import { resolveDrumKit } from '../../../services/deviceResolution';
import { createFaustDevice } from '../../faustDeviceFactory';
import { NATIVE_DSP_DEVICE_FACTORIES, isNativeDspDevice } from '../nativeDspDeviceFactories';
import { DECLARED_NODELESS_OFFLINE_RENDERERS, isNodelessOfflineDeviceType } from '../nodelessOfflineDeviceTypes';
import { createDeviceRegistry } from '../setupDeviceStrategies';
import { UNRENDERABLE_CATALOG_DEVICE_TYPES } from '../unrenderableCatalogDeviceTypes';
import { isUnsupportedDeviceTypeError } from '../unsupportedDeviceTypeError';

// `createReverb` builds its impulse with the `new AudioBuffer(...)` constructor
// form, which jsdom omits entirely. Supplying the missing browser global is
// what lets the reverb factories actually run here — the same stub three other
// device specs already install. It adds a capability the environment lacks; it
// does not stand in for any device code.
vi.stubGlobal('AudioBuffer', MockAudioBuffer);

/**
 * Every device the catalog offers must have *some* offline render path, and
 * this guard proves it as far as Node can.
 *
 * It replaces a hardcoded list of eleven native device types that was checked
 * against the registries' own matchers. That guard asked "does a factory claim
 * this type" and never "does the result work", so it stayed green while
 * `builtin-crumbs` and `crust` had no offline implementation at all. Crumbs has
 * one now (`CrumbsInstance` → `crumbs-processor` → `CrumbsNode`), so it has
 * moved out of the exemption table and into the native DSP cohort.
 *
 * The left side is always `getPlatformPlugins()` — what the Content Browser and
 * the mixer's device menu offer the user. It is authored for a user-visible
 * feature by unrelated work; nobody edits it to make a test pass, and adding a
 * device to the product necessarily adds it there. The catalog is read under a
 * stubbed native runtime, because that is the runtime on which every entry is
 * offered, and native is a strict superset.
 *
 * ## What each cohort actually proves, and what it does not
 *
 * The right side differs by which arm of the registry claims the id, in the
 * registry's own dispatch order, because the three arms are not equally
 * testable off a real audio device. Stating that per cohort matters: an earlier
 * revision of this file asserted "built for real" across the board while its
 * single case could only ever observe *type dispatch*.
 *
 * - **WebAudio builtins** are **built for real** and must hand back a node.
 *   This runs against `createMockAudioContext()`, not the seven-method
 *   `OfflineAudioContext` stub in `setupTests.ts` — that stub has no
 *   `createBiquadFilter`, `createDelay`, `createDynamicsCompressor`,
 *   `createOscillator` or `createWaveShaper`, so **forty of the forty-one**
 *   chain-rendered ids died in a `TypeError` before reaching any device code.
 *   The old assertion only asked whether the failure was
 *   `UnsupportedDeviceTypeError`, so all forty passed while building nothing.
 * - **Native DSP devices** cannot be built here: `create` fetches a wasm binary.
 *   They are checked **structurally, against a second independently authored
 *   table** — the id must resolve to a factory in `NATIVE_DSP_DEVICE_FACTORIES`
 *   *and* to a live descriptor in `wasmDeviceRegistry`. That is what stops
 *   "claimed by the offline matcher, unbuildable offline" from being silent: an
 *   offline row with no live counterpart, or a live device with no offline row,
 *   fails here. It does **not** prove the wasm module loads or renders audio.
 * - **Faust devices** cannot be compiled here (no Faust compiler under Node).
 *   The id must be registered in the Faust engine by `registerBuiltinFaustDSP` /
 *   `registerProModulationEffects` — the same registration `compileFaustDSP`
 *   requires and the same state the registry matcher reads. A catalog Faust id
 *   nobody registered fails. It does **not** prove the DSP compiles.
 * - **Anything claimed by no arm** is a registry miss, which is the refusal
 *   case, so it must appear in `UNRENDERABLE_CATALOG_DEVICE_TYPES`.
 *
 * Exemptions assert in both directions — an id listed as unrenderable that
 * *gains* an implementation fails this file until the entry is deleted, so the
 * list cannot rot into a permanent excuse.
 */

/**
 * Catalog ids with no offline render path, read from the production table that
 * `buildDeviceChain` gates its refusal on. Deliberately the same object rather
 * than a copy: the runtime decision and this guard must be the same claim, and
 * a second list would be free to drift from the first.
 */
const NO_OFFLINE_IMPLEMENTATION = UNRENDERABLE_CATALOG_DEVICE_TYPES;

/**
 * The whole catalog: `getPlatformPlugins` hides `platform: 'native'` entries
 * from a browser build, and the native runtime is the superset.
 */
function readFullDeviceCatalog(): string[] {
    Object.defineProperty(window, 'sourdaw', { value: {}, configurable: true });
    try {
        return getPlatformPlugins().map((descriptor) => descriptor.id);
    } finally {
        Reflect.deleteProperty(window, 'sourdaw');
    }
}

const CATALOG_IDS = readFullDeviceCatalog();

const CHAIN_RENDERED_IDS = CATALOG_IDS.filter(
    (id) => !isNodelessOfflineDeviceType(id) && NO_OFFLINE_IMPLEMENTATION[id] === undefined
);

function buildOfflineRegistry() {
    return createDeviceRegistry({
        faustModuleMatcher: isFaustModule,
        faustInstrumentMatcher: isFaustInstrumentModule,
        createFaustDevice: ({ ctx, faustModuleId }) =>
            createFaustDevice({ ctx, faustModuleId, compileFaustDSP, createFaustNode }),
    });
}

function makeCatalogDevice(deviceType: string): Device {
    return { id: `probe-${deviceType}`, name: deviceType, type: deviceType, bypassed: false, parameterValues: {} };
}

/**
 * Which registry arm claims this id, in `createDeviceRegistry`'s registration
 * order — the order `DeviceFactoryRegistry.createDevice` walks. Mirroring the
 * order matters, and the `builtin-` arm is where it bites: it is a prefix
 * match registered first, so it used to swallow *every* `builtin-*` id.
 * `builtin-crumbs` is a native DSP device with that prefix, so the production
 * registration now excludes native ids from the WebAudio arm — reproducing the
 * fall-through live playback has always had, where `TrackNode.addDevice` tries
 * the built-in factory and moves on to the wasm registry when it returns
 * nothing. This mirrors that exclusion; it is not an exemption for Crumbs, and
 * the native cohort's own checks still apply to it.
 */
type RegistryArm = 'webAudio' | 'faust' | 'nativeDsp' | 'unclaimed';

function registryArmFor(deviceType: string): RegistryArm {
    if (deviceType.startsWith('builtin-') && !isNativeDspDevice(deviceType)) {
        return 'webAudio';
    }
    if (isFaustModule(deviceType)) {
        return 'faust';
    }
    if (isNativeDspDevice(deviceType)) {
        return 'nativeDsp';
    }
    return 'unclaimed';
}

/** The `UnsupportedDeviceTypeError` this device type raises, or null. */
async function coverageFailureFor(deviceType: string): Promise<unknown> {
    const registry = buildOfflineRegistry();
    const ctx = asBaseAudioContext(createMockAudioContext());
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

    it('leaves no chain-rendered catalog id unclaimed by every registry arm', () => {
        const unclaimed = CHAIN_RENDERED_IDS.filter((id) => registryArmFor(id) === 'unclaimed');

        // An unclaimed id is a registry miss, which is the refusal case. It
        // belongs on the unrenderable table, not in the rendered set.
        expect(unclaimed).toEqual([]);
    });

    it('checks each registry arm with at least one real catalog device', () => {
        const armCounts = { webAudio: 0, faust: 0, nativeDsp: 0, unclaimed: 0 };
        for (const id of CHAIN_RENDERED_IDS) {
            armCounts[registryArmFor(id)]++;
        }

        // A cohort that empties out silently retires its own check.
        expect(armCounts.webAudio).toBeGreaterThan(10);
        expect(armCounts.faust).toBeGreaterThan(5);
        expect(armCounts.nativeDsp).toBeGreaterThan(5);
    });

    const WEB_AUDIO_IDS = CHAIN_RENDERED_IDS.filter((id) => registryArmFor(id) === 'webAudio');

    it.each(WEB_AUDIO_IDS)('builds %s for real and returns a connectable node', async (deviceType) => {
        const registry = buildOfflineRegistry();
        const ctx = asBaseAudioContext(createMockAudioContext());

        const strategy = await registry.createDevice(ctx, makeCatalogDevice(deviceType));

        expect(strategy.node.inputNode).toBeTruthy();
        expect(strategy.node.outputNode).toBeTruthy();
    });

    const NATIVE_DSP_IDS = CHAIN_RENDERED_IDS.filter((id) => registryArmFor(id) === 'nativeDsp');

    // A native device's `create` fetches wasm, so it cannot be built here. What
    // can be proved is that the offline table and the *live* registry claim the
    // same devices — the divergence that hid GrandBoule from every device chain
    // while live playback was fine, and the shape of hole this PR exists to
    // stop being silent.
    it.each(NATIVE_DSP_IDS)('routes %s to a native factory that the live registry also claims', (deviceType) => {
        const offlineFactory = NATIVE_DSP_DEVICE_FACTORIES.find((factory) => factory.matches(deviceType));

        expect(offlineFactory?.create).toBeTypeOf('function');
        expect(findWasmDescriptor(deviceType)).toBeDefined();
    });

    // The reverse edge: a device the live engine can build must not be missing
    // from the offline table, which is exactly how a Rust-backed device becomes
    // silent in a render while sounding correct in playback.
    it('claims offline every catalog device the live wasm registry can build', () => {
        const liveOnly = CATALOG_IDS.filter((id) => {
            if (findWasmDescriptor(id) === undefined) {
                return false;
            }
            // The live registry also carries a Faust descriptor, which is the
            // offline Faust arm's counterpart rather than a native one. Both
            // arms count as "claimed offline"; anything else does not.
            const arm = registryArmFor(id);
            return arm !== 'nativeDsp' && arm !== 'faust';
        });

        expect(liveOnly).toEqual([]);
    });

    const FAUST_IDS = CHAIN_RENDERED_IDS.filter((id) => registryArmFor(id) === 'faust');

    // Faust cannot compile under Node. What is checked is that the catalog id
    // is registered in the Faust engine — the registration `compileFaustDSP`
    // needs — so a catalog entry nobody registered cannot pass unnoticed.
    it.each(FAUST_IDS)('has %s registered in the Faust engine the app primes at startup', (deviceType) => {
        expect(isFaustModule(deviceType)).toBe(true);
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

    /**
     * The node-less exemption is the one gate that could otherwise assert a
     * table against itself: the rendered-set filter above uses
     * `isNodelessOfflineDeviceType`, and so does the runtime refusal. Two of its
     * three arms are prefix matches, so a future `builtin-synth-wavetable`
     * backed by a real audio node would exempt itself from the guard *and* the
     * refusal with nobody editing a list, and its node would be silently
     * dropped from every render.
     *
     * Both directions are pinned here against things outside the exemption.
     */
    describe('node-less exemptions', () => {
        const EXEMPTED_CATALOG_IDS = CATALOG_IDS.filter((id) => isNodelessOfflineDeviceType(id));

        it('exempts a non-empty set, so these checks cannot pass vacuously', () => {
            expect(EXEMPTED_CATALOG_IDS.length).toBeGreaterThan(4);
        });

        // The direction that catches the wavetable case: if the offline
        // registry *can* build a node for an exempted id, the exemption is
        // throwing that node away rather than routing around a device that has
        // none.
        it.each(EXEMPTED_CATALOG_IDS)(
            'builds no audio node for %s, so nothing is being dropped',
            async (deviceType) => {
                const failure = await coverageFailureFor(deviceType);

                expect(isUnsupportedDeviceTypeError(failure)).toBe(true);
            }
        );

        // The other direction: something has to actually voice it. An exempted
        // id no scheduler claims renders nowhere at all.
        it.each(EXEMPTED_CATALOG_IDS)('has an offline scheduler that voices %s', (deviceType) => {
            const probe = { type: deviceType, parameterValues: { gain: 0.77, kit: 1 } };

            const voicedByNoteScheduler = getSynthParamsFromDevices([probe]).gain === 0.77;
            const voicedByKitScheduler = resolveDrumKit([probe]) !== null;
            const voicedByMidiFxRack = DECLARED_NODELESS_OFFLINE_RENDERERS[deviceType] !== undefined;

            expect(voicedByNoteScheduler || voicedByKitScheduler || voicedByMidiFxRack).toBe(true);
        });
    });
});
