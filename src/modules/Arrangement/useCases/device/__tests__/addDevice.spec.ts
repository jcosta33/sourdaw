import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addDevice } from '../addDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    getPlatformPlugins: vi.fn(),
    addDeviceToStrip: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(() => ({
        acceptance: 'accepted',
        application: 'applied',
    })),
    updateDeviceParam: vi.fn(),
    compileFaustDSP: vi.fn(),
    loadPlugin: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    notifyUser: vi.fn(),
    isDeviceSupportedOnCurrentPlatform: vi.fn<(deviceType: string) => boolean>(() => true),
}));

vi.mock('../../../models/DeviceParameter', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../models/DeviceParameter')>()),
    isDeviceSupportedOnCurrentPlatform: mocks.isDeviceSupportedOnCurrentPlatform,
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../getPlatformPlugins', () => ({
    getPlatformPlugins: mocks.getPlatformPlugins,
}));

vi.mock('../../projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('../applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    compileFaustDSP: mocks.compileFaustDSP,
    loadPlugin: mocks.loadPlugin,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('addDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.getPlatformPlugins.mockReturnValue([]);
        mocks.isDeviceSupportedOnCurrentPlatform.mockReturnValue(true);
    });

    it('adds a generic device if plugin is not found', () => {
        const result = addDevice('t1', 'CustomEffect');

        expect(result).toMatchObject({
            name: 'CustomEffect',
            type: 'CustomEffect',
            bypassed: false,
        });
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
    });

    it('returns null when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(addDevice('t1', 'reverb')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    // Crust is a shipped limiter with a real DSP engine, so it places like any
    // other catalog effect. `addDevice` used to refuse it outright while the
    // device browser still advertised it, which produced an error toast on add.
    it('places a crust device and pushes its catalog parameters to the strip', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', devices: [], isLive: true, hasStrip: true }],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            {
                id: 'crust',
                name: 'Crust',
                parameters: [
                    { id: 'ceiling', value: -0.3 },
                    { id: 'lookahead', value: 2 },
                ],
            },
        ]);

        const result = addDevice('t1', 'crust');

        expect(result).toMatchObject({ type: 'crust', name: 'Crust', bypassed: false });
        expect(result?.parameterValues).toMatchObject({ ceiling: -0.3, lookahead: 2 });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
    });

    // `getPlatformPlugins()` is platform-filtered, so in a browser build a
    // native-only id resolves to no plugin and falls into the generic branch —
    // writing a device with no parameters whose type is on the export refusal
    // table. The project then cannot be exported over a device that was never
    // properly placed. This is the same class as the `crust` guard beside it.
    it('refuses a device the current platform cannot host, instead of writing a malformed one', () => {
        mocks.isDeviceSupportedOnCurrentPlatform.mockReturnValue(false);

        const result = addDevice('t1', 'builtin-crumbs');

        expect(result).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(String(mocks.notifyUser.mock.calls[0]?.[0])).toContain('builtin-crumbs');
        expect(mocks.notifyUser.mock.calls[0]?.[1]).toBe('error');
    });

    // The pass-through the platform helper already guarantees: a type the
    // catalog does not know is not a platform decision, and must still be
    // placeable — external plugins and older projects depend on it.
    it('still places a device type the catalog does not know', () => {
        mocks.isDeviceSupportedOnCurrentPlatform.mockReturnValue(true);

        const result = addDevice('t1', 'Drum Comp');

        expect(result).toMatchObject({ type: 'Drum Comp' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
    });

    it('adds a registered plugin and notifies engine', () => {
        const mockPlugin = {
            id: 'p1',
            name: 'Reverb',
            parameters: [{ id: 'wet', value: 0.5 }],
        };
        mocks.getPlatformPlugins.mockReturnValue([mockPlugin]);

        const result = addDevice('t1', 'Reverb');

        expect(result).toMatchObject({
            name: 'Reverb',
            type: 'p1',
            parameterValues: { wet: 0.5 },
        });
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', result?.id, 'wet', 0.5);
    });

    it('persists and publishes internal parameters for newly added devices', () => {
        mocks.getPlatformPlugins.mockReturnValue([
            {
                id: 'dutch-oven',
                name: 'Dutch Oven',
                internalParameterValues: { fdn_damping_version: 2 },
                parameters: [{ id: 'damping', value: 0.3 }],
            },
        ]);

        const result = addDevice('t1', 'dutch-oven');

        expect(result?.parameterValues).toEqual({ fdn_damping_version: 2, damping: 0.3 });
        expect(mocks.updateDeviceParam).toHaveBeenNthCalledWith(1, 't1', result?.id, 'fdn_damping_version', 2);
        expect(mocks.updateDeviceParam).toHaveBeenNthCalledWith(2, 't1', result?.id, 'damping', 0.3);
    });

    it('uses an explicit empty internal parameter set for an unversioned saved device', () => {
        mocks.getPlatformPlugins.mockReturnValue([
            {
                id: 'dutch-oven',
                name: 'Dutch Oven',
                internalParameterValues: { fdn_damping_version: 2 },
                parameters: [{ id: 'damping', value: 0.3 }],
            },
        ]);

        const result = addDevice('t1', 'dutch-oven', undefined, undefined, undefined, {});

        expect(result?.parameterValues).toEqual({ damping: 0.3 });
        expect(mocks.updateDeviceParam).toHaveBeenCalledOnce();
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', result?.id, 'damping', 0.3);
    });

    it('uses a caller-reserved device ID for project and runtime identity', () => {
        mocks.getPlatformPlugins.mockReturnValue([{ id: 'p1', name: 'Reverb', parameters: [] }]);

        const result = addDevice('t1', 'p1', undefined, 'reserved-device');

        expect(result?.id).toBe('reserved-device');
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
    });

    it('rejects a caller-reserved device ID that already exists anywhere in the project', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', devices: [] },
                { id: 't2', kind: 'audio', devices: [{ id: 'reserved-device' }] },
            ],
        });

        expect(addDevice('t1', 'p1', undefined, 'reserved-device')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
    });

    // Resolving by id costs the caller's label unless it survives the call:
    // without the override the device is named after the plugin that matched, so
    // a preset labelled `Drum Comp` would land in the device chain, inspector,
    // automation lane and modulation matrix as `Compressor`.
    it('labels the device with the caller-supplied name instead of the resolved plugin name', () => {
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'builtin-compressor', name: 'Compressor', parameters: [{ id: 'comp-ratio', value: 4 }] },
        ]);

        const result = addDevice('t1', 'builtin-compressor', 'Drum Comp');

        expect(result).toMatchObject({
            name: 'Drum Comp',
            type: 'builtin-compressor',
            parameterValues: { 'comp-ratio': 4 },
        });
    });

    it('falls back to the resolved plugin name when no label is supplied', () => {
        mocks.getPlatformPlugins.mockReturnValue([{ id: 'builtin-compressor', name: 'Compressor', parameters: [] }]);

        expect(addDevice('t1', 'builtin-compressor')).toMatchObject({
            name: 'Compressor',
            type: 'builtin-compressor',
        });
    });

    // Three catalog names are carried by two plugins each — `De-esser`,
    // `LUFS Meter` and `Stereo Widener` all exist as a builtin and as a Faust
    // build. The name branch is a `.find()`, so it returns whichever the
    // registry lists first no matter which one the caller meant; only the id
    // identifies a plugin. Callers holding both must pass the id.
    it('resolves an id to exactly that plugin where two catalog entries share a name', () => {
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'builtin-deesser', name: 'De-esser', parameters: [] },
            { id: 'faust-de-esser', name: 'De-esser', parameters: [] },
        ]);

        expect(addDevice('t1', 'faust-de-esser')).toMatchObject({ type: 'faust-de-esser' });
        expect(addDevice('t1', 'De-esser')).toMatchObject({ type: 'builtin-deesser' });
    });

    it('persists a registered non-Toaster on an ordinary folder without allocating an engine strip', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'folder-1', kind: 'folder', devices: [] }] });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'p1', name: 'Reverb', parameters: [{ id: 'wet', value: 0.5 }] },
        ]);

        const result = addDevice('folder-1', 'Reverb');

        expect(result).toMatchObject({ type: 'p1' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('folder-1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('reprojects child stems when restoring the last Toaster to a folder', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 'folder-1',
                    kind: 'folder',
                    devices: [
                        { id: 'reverb-1', type: 'p1', bypassed: true, parameterValues: { wet: 0.25, room: 0.5 } },
                        { id: 'faust-1', type: 'faust-delay', parameterValues: { feedback: 0.4 } },
                        {
                            id: 'external-1',
                            type: 'external-plugin',
                            parameterValues: { mix: 0.8 },
                            externalPluginId: 'plugin-1',
                            externalInstanceId: 'instance-1',
                        },
                    ],
                },
                { id: 'stem-1', kind: 'audio', parentId: 'folder-1', devices: [] },
                { id: 'other', kind: 'audio', parentId: null, devices: [{ id: 'reverb-1', type: 'p1' }] },
            ],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'toaster', name: 'Toaster', parameters: [{ id: 'swing', value: 0.2 }] },
        ]);
        const result = addDevice('folder-1', 'Toaster');

        expect(result).toMatchObject({ type: 'toaster' });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(1, {
            trackId: 'folder-1',
            activateDormantExternalPlugins: true,
        });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(2, {
            trackId: 'stem-1',
            activateDormantExternalPlugins: true,
        });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledTimes(2);
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
    });

    it('adds a supported device to an already-live Toaster folder', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'folder-1', kind: 'folder', devices: [{ id: 'toaster-1', type: 'toaster' }] }],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'p1', name: 'Reverb', parameters: [{ id: 'wet', value: 0.5 }] },
        ]);

        const result = addDevice('folder-1', 'Reverb');

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('folder-1', result?.id, 'wet', 0.5);
    });

    it('compiles Faust DSP if it starts with faust-', async () => {
        const mockPlugin = {
            id: 'faust-synth',
            name: 'Faust Synth',
            parameters: [],
        };
        mocks.getPlatformPlugins.mockReturnValue([mockPlugin]);

        addDevice('t1', 'faust-synth');

        await vi.waitFor(() => {
            expect(mocks.compileFaustDSP).toHaveBeenCalledWith('faust-synth');
        });
    });

    it('rejects duplicate track identity before truth or runtime work', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 'duplicate', kind: 'audio', devices: [] },
                { id: 'duplicate', kind: 'audio', devices: [] },
            ],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'faust-synth', name: 'Faust Synth', parameters: [{ id: 'gain', value: 0.5 }] },
        ]);

        expect(addDevice('duplicate', 'faust-synth')).toBeNull();
        expect(mocks.getPlatformPlugins).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA before ID allocation, store writes, engine calls, or plugin compilation', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', devices: [] }] });
        mocks.getPlatformPlugins.mockReturnValue([{ id: 'faust-synth', name: 'Faust Synth', parameters: [] }]);

        expect(addDevice('vca-1', 'faust-synth')).toBeNull();
        expect(mocks.getPlatformPlugins).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
    });
});
