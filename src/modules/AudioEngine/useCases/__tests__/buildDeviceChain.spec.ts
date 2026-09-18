import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        compileFaustDSP: vi.fn(),
        createFaustDevice: vi.fn(),
        createFaustNode: vi.fn(),
        isFaustModule: vi.fn(),
        isFaustInstrumentModule: vi.fn(),
        loggerWarn: vi.fn(),
        isUnrenderableCatalogDeviceType: vi.fn<(deviceType: string) => boolean>(() => false),
        readLoadedExternalInstanceIds: vi.fn<() => ReadonlySet<string>>(() => new Set()),
        isDesktopRuntime: vi.fn<() => boolean>(() => true),
    },
}));

// The load state decides the plugin refusal, so these tests state it directly
// instead of reaching through PluginHost's store. What populates the real set
// is pinned by that module's own specs.
vi.mock('../livePlayback/readLoadedExternalInstanceIds', () => ({
    readLoadedExternalInstanceIds: mocks.readLoadedExternalInstanceIds,
}));

vi.mock('../../repositories/deviceStrategy/isDesktopExternalPluginRuntime', () => ({
    isDesktopExternalPluginRuntime: mocks.isDesktopRuntime,
}));

// `UNRENDERABLE_CATALOG_DEVICE_TYPES` is empty today: its one entry was `crust`,
// and Crust now has an engine. The refusal path it feeds is still live product
// behaviour — a future catalog device wired to no offline factory lands on it —
// so these three tests keep exercising it against a stubbed table rather than
// being deleted along with the entry. `offlineDeviceCoverage.spec.ts` is what
// pins the real table's contents; this file pins what happens when it hits.
vi.mock('../../repositories/deviceStrategy/unrenderableCatalogDeviceTypes', () => ({
    isUnrenderableCatalogDeviceType: mocks.isUnrenderableCatalogDeviceType,
    UNRENDERABLE_CATALOG_DEVICE_TYPES: {},
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
    isFaustModule: mocks.isFaustModule,
    isFaustInstrumentModule: mocks.isFaustInstrumentModule,
}));

vi.mock('../../repositories/faustDeviceFactory', () => ({
    createFaustDevice: mocks.createFaustDevice,
}));

describe('buildDeviceChain', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.isFaustInstrumentModule.mockReturnValue(false);
        mocks.isUnrenderableCatalogDeviceType.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set());
        mocks.isDesktopRuntime.mockReturnValue(true);
    });

    it('should connect input to output when there are no active devices', async () => {
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const ctx = {} as BaseAudioContext;

        const bypassed: Device = {
            id: 'd1',
            name: 'Bypassed',
            type: 'builtin-synth',
            bypassed: true,
            parameterValues: {},
        };

        const entries = await buildDeviceChain(ctx, [bypassed], input, output);

        expect(entries).toEqual([]);
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    it('should create Faust devices through Plugin-backed use-case composition', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const faustInput = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const faustOutput = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const offlineNode = {
            inputNode: faustInput,
            outputNode: faustOutput,
            nodes: [{ setParamValue: vi.fn() } as unknown as AudioNode],
        };
        mocks.isFaustModule.mockImplementation((type) => type === 'faust-x');
        mocks.createFaustDevice.mockResolvedValue(offlineNode);
        const ctx = {} as BaseAudioContext;
        const device: Device = {
            id: 'd1',
            name: 'Faust',
            type: 'faust-x',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain(ctx, [device], input, output);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.deviceType).toBe('faust-x');
        expect(mocks.createFaustDevice).toHaveBeenCalledWith({
            ctx,
            faustModuleId: 'faust-x',
            compileFaustDSP: mocks.compileFaustDSP,
            createFaustNode: mocks.createFaustNode,
        });
        expect(input.connect).toHaveBeenCalledWith(faustInput);
        expect(faustOutput.connect).toHaveBeenCalledWith(output);
    });

    // A catalog device with no offline implementation is a coverage hole in our
    // own code. The export used to warn and continue, so the render came back
    // missing the device — and, for an instrument, came back as the fallback
    // synth instead. A render must contain what playback contains, so this now
    // fails loudly.
    it('fails the export for a catalog device with no offline implementation', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        mocks.isFaustModule.mockReturnValue(false);
        mocks.isUnrenderableCatalogDeviceType.mockImplementation((type) => type === 'catalog-only');
        const unrenderable: Device = {
            id: 'd1',
            name: 'Catalog Only',
            type: 'catalog-only',
            bypassed: false,
            parameterValues: {},
        };

        const failure = await buildDeviceChain({} as BaseAudioContext, [unrenderable], input, output, {
            trackName: 'Lead',
        }).catch((error: unknown) => error);

        expect(failure).toMatchObject({ _tag: 'Export' });
        expect((failure as Error).message).toContain('catalog-only');
        expect((failure as Error).message).toContain('Lead');
        // The partially wired chain must not be handed back as a usable render.
        expect(input.connect).not.toHaveBeenCalledWith(output);
    });

    // The remedy has to be one the user can actually carry out. Freezing runs
    // this same chain build for the target *and* every upstream contributor, so
    // "freeze the track" throws exactly the same error — and freezing an
    // unrelated track fails too whenever a contributor holds the device.
    it('offers no remedy the failing chain build would itself reject', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        mocks.isFaustModule.mockReturnValue(false);
        mocks.isUnrenderableCatalogDeviceType.mockImplementation((type) => type === 'catalog-only');
        const unrenderable: Device = {
            id: 'd1',
            name: 'Catalog Only',
            type: 'catalog-only',
            bypassed: false,
            parameterValues: {},
        };

        const failure = await buildDeviceChain({} as BaseAudioContext, [unrenderable], input, output, {
            trackName: 'Sampler',
        }).catch((error: unknown) => error);

        expect((failure as Error).message).toContain('Remove the device from the track to render without it.');
        expect((failure as Error).message).not.toContain('freeze');
        // The same sentence is what Freeze, Bounce and the stems warning show,
        // so naming one command ("Export stopped") was wrong on three of four.
        expect((failure as Error).message).not.toContain('Export');
        expect((failure as Error).message).not.toContain('export');
    });

    // The user has to find the device in the rack, and the chip there shows the
    // display name, not the raw type. Naming only the type asks them to
    // translate a raw id into the label they can see themselves.
    it('names the device the way the rack labels it, as well as by type', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        mocks.isFaustModule.mockReturnValue(false);
        mocks.isUnrenderableCatalogDeviceType.mockImplementation((type) => type === 'catalog-only');
        const unrenderable: Device = {
            id: 'd1',
            name: 'Catalog Only',
            type: 'catalog-only',
            bypassed: false,
            parameterValues: {},
        };

        const failure = await buildDeviceChain({} as BaseAudioContext, [unrenderable], input, output, {
            trackName: 'Sampler',
        }).catch((error: unknown) => error);

        expect((failure as Error).message).toContain('"Catalog Only"');
        expect((failure as Error).message).toContain('catalog-only');
    });

    // `addDevice` stores an unmatched string verbatim as the device type, so
    // saved projects carry types the product never claimed — factory presets
    // wrote effect *display names* like `Drum Comp`. Such a device is silent in
    // live playback too (no descriptor matches, so `TrackNode` builds no node),
    // so dropping it offline reproduces playback rather than diverging from it.
    // Refusing would make those projects permanently unexportable.
    it.each([['Drum Comp', 'a stale factory-preset display name']])(
        'degrades %s (%s) instead of failing the export',
        async (deviceType) => {
            vi.stubGlobal('AudioWorkletNode', undefined);
            const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
            const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
            const onWarning = vi.fn();
            mocks.isFaustModule.mockReturnValue(false);
            const device: Device = {
                id: 'd1',
                name: deviceType,
                type: deviceType,
                bypassed: false,
                parameterValues: {},
            };

            const entries = await buildDeviceChain({} as BaseAudioContext, [device], input, output, {
                trackName: 'Drums',
                onWarning,
            });

            expect(entries).toEqual([]);
            const warning = onWarning.mock.calls[0]?.[0] as string;
            expect(warning).toContain(deviceType);
            expect(warning).toContain('Drums');
            expect(input.connect).toHaveBeenCalledWith(output);
        }
    );

    /** A plugin device naming instance `inst-1`; the mocked reader decides whether it is loaded. */
    function hostedPlugin(overrides: Partial<Device> = {}): Device {
        return {
            id: 'd1',
            name: 'Analog EQ',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalInstanceId: 'inst-1',
            ...overrides,
        };
    }

    // A loaded hosted plugin sounds live through the native engine (the Web
    // Audio graph carries only a unity pass-through for it) the moment it
    // attaches, so it is not the "never sounded live" case above. Freeze and
    // mixdown could not previously build it either, and used to drop it
    // silently as a coverage-hole degrade — the dry render then diverges from
    // what the session actually plays, worst on freeze where it replaces the
    // audible track. The native offline path cannot host a plugin instance
    // yet, so refusing is the honest behaviour until a bounce through the
    // live engine exists.
    //
    // `readLoadedExternalInstanceIds` reports both scenarios as the same
    // loaded id — the pending-vs-attached split lives in
    // `externalPluginParameterStore`'s own snapshot, which this suite stubs
    // out — so both share one body: the point of #4355 is that they must
    // behave identically here.
    it.each([
        ['parked-loaded (loaded while the transport is parked, engineAttached: false)'],
        ['attached (engine reports the instance attached)'],
    ])('refuses the render for a hosted plugin on the desktop runtime — %s', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set(['inst-1']));
        mocks.isDesktopRuntime.mockReturnValue(true);

        const failure = await buildDeviceChain({} as BaseAudioContext, [hostedPlugin()], input, output, {
            trackName: 'Guitar',
            onWarning,
        }).catch((error: unknown) => error);

        expect(failure).toMatchObject({ _tag: 'Export' });
        const message = (failure as Error).message;
        expect(message).toContain('Guitar');
        expect(message).toContain('Analog EQ');
        expect(message).toContain('external-plugin');
        expect(message).toContain('Bypass or remove the plugin to render without it.');
        // Freeze and Bounce show this same sentence, so it names no command.
        expect(message).not.toContain('Export');
        expect(message).not.toContain('export');
        expect(onWarning).not.toHaveBeenCalled();
        expect(input.connect).not.toHaveBeenCalledWith(output);
    });

    // The browser build's `loadPlugin` stub always resolves
    // `engine_plugin_id: null` and still writes a snapshot (#4355), so a
    // browser-build project reports a loaded instance that never sounds.
    // `isDesktopRuntime()` is the second half of the gate: a loaded instance
    // off the desktop runtime degrades exactly like a never-loaded one.
    it('degrades a hosted plugin loaded off the desktop runtime (browser build)', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set(['inst-1']));
        mocks.isDesktopRuntime.mockReturnValue(false);

        const entries = await buildDeviceChain({} as BaseAudioContext, [hostedPlugin()], input, output, {
            trackName: 'Guitar',
            onWarning,
        });

        expect(entries).toEqual([]);
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // The device type alone is not the question; the device's load state is.
    // A device carrying no instance id was never bound to one — `duplicateTrack`
    // clears `externalInstanceId`, and a track template or a browser-build
    // project never had one — so `TrackNode` gives it a unity pass-through and
    // it is silent in live playback. Refusing would make such a project
    // permanently unrenderable over a device it never sounded.
    it('degrades a hosted plugin that names no engine instance', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set(['inst-1']));
        mocks.isDesktopRuntime.mockReturnValue(true);

        const entries = await buildDeviceChain(
            {} as BaseAudioContext,
            [hostedPlugin({ externalInstanceId: undefined })],
            input,
            output,
            { trackName: 'Duplicated guitar', onWarning }
        );

        expect(entries).toEqual([]);
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // An instance id with no snapshot in the store was never loaded this
    // generation — the device was never activated, a duplicated track or
    // template carries a stale id, or the snapshot was cleared — and nothing
    // is sounding it live either.
    it('degrades a hosted plugin whose instance was never loaded', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set(['some-other-instance']));
        mocks.isDesktopRuntime.mockReturnValue(true);

        const entries = await buildDeviceChain({} as BaseAudioContext, [hostedPlugin()], input, output, {
            trackName: 'Guitar',
            onWarning,
        });

        expect(entries).toEqual([]);
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // A strip that is never scheduled contributes silence by construction, so
    // a hosted plugin on it cannot make the file differ from the session —
    // mirrors the catalog-device case above for the plugin refusal.
    it('degrades a loaded hosted plugin on a track that contributes no audio', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set(['inst-1']));
        mocks.isDesktopRuntime.mockReturnValue(true);

        const entries = await buildDeviceChain({} as BaseAudioContext, [hostedPlugin()], input, output, {
            trackName: 'Muted guitar',
            onWarning,
            contributesAudio: false,
        });

        expect(entries).toEqual([]);
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // The catch this refusal lives in is only reached for a device the chain
    // tries to build. A bypassed device is filtered out before construction,
    // so bypassing a hosted plugin is a real remedy, not a dead end.
    it('skips a bypassed loaded hosted plugin without refusing or warning', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.readLoadedExternalInstanceIds.mockReturnValue(new Set(['inst-1']));
        mocks.isDesktopRuntime.mockReturnValue(true);

        const entries = await buildDeviceChain(
            {} as BaseAudioContext,
            [hostedPlugin({ bypassed: true })],
            input,
            output,
            { trackName: 'Guitar', onWarning }
        );

        expect(entries).toEqual([]);
        expect(onWarning).not.toHaveBeenCalled();
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // A mixdown builds a strip for every non-disabled track so the routing
    // graph matches live, but only schedules the audible ones and the cue-send
    // feeders. A strip that is never scheduled contributes silence, so an
    // unrenderable device on it cannot make the file differ from the session.
    it('degrades an unrenderable catalog device on a track that contributes no audio', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        mocks.isUnrenderableCatalogDeviceType.mockImplementation((type) => type === 'catalog-only');
        const unrenderable: Device = {
            id: 'd1',
            name: 'Catalog Only',
            type: 'catalog-only',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain({} as BaseAudioContext, [unrenderable], input, output, {
            trackName: 'Muted limiter',
            onWarning,
            contributesAudio: false,
        });

        expect(entries).toEqual([]);
        expect(onWarning.mock.calls[0]?.[0]).toContain('catalog-only');
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // Crumbs used to be this file's example of a `builtin-`-prefixed id the
    // WebAudio arm claimed and could not build, and the export refused for it.
    // It has a real render path now (`CrumbsInstance` → `crumbs-processor`), so
    // the refusal must *not* fire for it: an environment without
    // `AudioWorkletNode` is a missing-asset failure, which degrades everywhere.
    // Whether it reaches the native arm at all is pinned in
    // `setupDeviceStrategies.spec.ts`; what matters here is that it is no
    // longer treated as a coverage hole.
    it('no longer refuses the export for Crumbs, which now has an offline render path', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockReturnValue(false);
        const crumbs: Device = {
            id: 'd1',
            name: 'Crumbs',
            type: 'builtin-crumbs',
            bypassed: false,
            parameterValues: {},
        };

        const outcome = await buildDeviceChain({} as BaseAudioContext, [crumbs], input, output, {
            trackName: 'Sampler',
            onWarning,
        }).catch((error: unknown) => error);

        expect(outcome).toEqual([]);
        expect(onWarning.mock.calls[0]?.[0]).toContain('builtin-crumbs');
        // The chain still completes, which is what "degrade" means here.
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // A registered factory that throws at runtime is an environment or asset
    // problem (missing WASM, unavailable worklet), not a coverage hole. That
    // stays degradable — but it must reach the user, not only the log.
    it('reports a runtime factory failure through the export warning channel', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        mocks.isFaustModule.mockImplementation((type) => type === 'faust-x');
        mocks.createFaustDevice.mockRejectedValue(new Error('worklet module unavailable'));
        const device: Device = {
            id: 'd1',
            name: 'Faust',
            type: 'faust-x',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain({} as BaseAudioContext, [device], input, output, {
            trackName: 'Bus',
            onWarning,
        });

        expect(entries).toEqual([]);
        const warning = onWarning.mock.calls[0]?.[0] as string;
        expect(warning).toContain('faust-x');
        expect(warning).toContain('Bus');
        expect(warning).toContain('worklet module unavailable');
        // Degraded, not aborted: the rest of the chain still reaches the output.
        expect(input.connect).toHaveBeenCalledWith(output);
    });

    // The node-less exemptions must not reach the failure path at all: these
    // devices are rendered by the note/kit schedulers, not the device chain.
    it.each([
        ['yeast', 'yeast-1'],
        ['builtin-synth', 'synth-1'],
        ['builtin-synth-strings', 'synth-2'],
        ['builtin-drum-kit', 'kit-1'],
        ['builtin-drum-machine-808', 'kit-2'],
        // The bare arm `isDrumDevice` has always matched and the node-less
        // table had dropped: `scheduleTrackClips` resolves it through
        // `getDrumKitDefByIndex` and renders it, so it must not warn.
        ['drum-kit', 'kit-3'],
        ['synth', 'synth-3'],
    ])('routes %s around the chain without warning or failing', async (type, id) => {
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const onWarning = vi.fn();
        const device: Device = { id, name: type, type, bypassed: false, parameterValues: {} };

        const entries = await buildDeviceChain({} as BaseAudioContext, [device], input, output, { onWarning });

        expect(entries).toEqual([]);
        expect(input.connect).toHaveBeenCalledWith(output);
        expect(onWarning).not.toHaveBeenCalled();
        expect(mocks.loggerWarn).not.toHaveBeenCalled();
    });

    // MD-4 — the note surface used to be attached to every entry, so the offline
    // scheduler read the first device in any chain as the track's instrument and
    // routed MIDI into a no-op instead of the fallback synth.
    it('gives no note surface to a device whose strategy cannot voice notes', async () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
        mocks.isFaustModule.mockImplementation((type) => type === 'faust-reverb');
        mocks.createFaustDevice.mockResolvedValue({
            inputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
            outputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
            nodes: [],
        });
        const device: Device = {
            id: 'd1',
            name: 'Faust Reverb',
            type: 'faust-reverb',
            bypassed: false,
            parameterValues: {},
        };

        const entries = await buildDeviceChain({} as BaseAudioContext, [device], input, output);

        expect(entries[0]?.instrumentControls).toBeUndefined();
    });
});
