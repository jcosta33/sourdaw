import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type initializeTrackStripFromSnapshot } from '#/modules/AudioEngine/useCases';

import { trackStore } from '../../stores/trackStore';
import { createTrack } from '../createTrack';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';
import { applySoloLogic } from '../toggleTrackState/applySoloLogic';

const mocks = vi.hoisted(() => ({
    getRuntimeGraphRevision: vi.fn(() => 0),
    initializeTrackStripFromSnapshot: vi.fn<typeof initializeTrackStripFromSnapshot>(() => ({
        acceptance: 'accepted' as const,
        application: 'applied' as const,
        correlation: { appRevision: 0, projectRevision: 'project-revision-1' },
        runtimeRevision: 1,
    })),
    ensureTrackStrip: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSoloGate: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateDeviceBypass: vi.fn(),
    activateExternalPlugin: vi.fn(),
    warn: vi.fn(),
    setSend: vi.fn(),
    wireSidechainRoutes: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    reportLatency: vi.fn(),
    soloMode: 'sip',
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));

vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getRuntimeGraphRevision: mocks.getRuntimeGraphRevision,
    initializeTrackStripFromSnapshot: mocks.initializeTrackStripFromSnapshot,
    ensureTrackStrip: mocks.ensureTrackStrip,
    setTrackOutput: mocks.setTrackOutput,
    setTrackGain: mocks.setTrackGain,
    setTrackPan: mocks.setTrackPan,
    setTrackMute: mocks.setTrackMute,
    setTrackSoloGate: mocks.setTrackSoloGate,
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
    updateDeviceBypass: mocks.updateDeviceBypass,
    resolveToasterPadBinding: mocks.resolveToasterPadBinding,
    reportLatency: mocks.reportLatency,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => 'project-revision-1',
}));

vi.mock('#/modules/Routing/useCases', () => ({
    setSend: mocks.setSend,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: {
        get value() {
            return { soloMode: mocks.soloMode };
        },
    },
}));

const initializationFailureResults = [
    { acceptance: 'rejected', application: 'not-applied', reason: 'runtime revision is stale' },
    {
        acceptance: 'accepted',
        application: 'needs-reconcile',
        compensation: 'failed',
        correlation: { appRevision: 0, projectRevision: 'project-revision-1' },
        reason: 'strip publication needs repair',
        runtimeRevision: 1,
    },
] satisfies readonly ReturnType<typeof initializeTrackStripFromSnapshot>[];

describe('projectTrackToLiveStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.soloMode = 'sip';
        mocks.resolveToasterPadBinding.mockReturnValue(undefined);
        trackStore.set({ tracks: [], selectedTrackId: null });
        applySoloLogic({ resetSavedGains: true, applyActions: false });
    });

    it('projects the current owned track in device-chain order and wires sidechains last', () => {
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        track.gain = 0.75;
        track.pan = -0.25;
        track.outputId = 'master';
        track.sends = [{ busId: 'bus-1', level: 0.4, preFader: true }];
        track.devices = [
            {
                id: 'device-1',
                name: 'Native effect',
                type: 'external-plugin',
                bypassed: true,
                parameterValues: { feedback: 0.6, mix: 0.3 },
                externalPluginId: 'persisted-native-plugin',
                externalInstanceId: 'persisted-native-instance',
                externalStateChunk: 'c2F2ZWQ=',
            },
        ];
        const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });
        const bus = createTrack({ id: 'bus-1', name: 'Bus', kind: 'bus' });
        trackStore.set({ tracks: [track, master, bus], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: track.id });

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith({
            schemaVersion: 1,
            command: 'initialize-track-strip',
            correlation: { appRevision: 0, projectRevision: 'project-revision-1' },
            nodes: [
                {
                    id: 'audio-1',
                    kind: 'audio',
                    devices: [
                        {
                            id: 'device-1',
                            type: 'external-plugin',
                            externalInstanceId: 'persisted-native-instance',
                            parameterIds: ['feedback', 'mix'],
                        },
                    ],
                },
            ],
            output: { kind: 'output', sourceId: 'audio-1', targetId: 'master' },
            parameters: [],
        });
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.setTrackGain).toHaveBeenCalledWith('audio-1', 0.75);
        expect(mocks.setTrackPan).toHaveBeenCalledWith('audio-1', -0.25);
        expect(mocks.setTrackMute).toHaveBeenCalledWith('audio-1', false);
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).toHaveBeenNthCalledWith(1, 'audio-1', 'device-1', 'feedback', 0.6);
        expect(mocks.updateDeviceParam).toHaveBeenNthCalledWith(2, 'audio-1', 'device-1', 'mix', 0.3);
        expect(mocks.updateDeviceBypass).toHaveBeenCalledWith('audio-1', 'device-1', true);
        expect(mocks.setSend).toHaveBeenCalledWith('audio-1', 'bus-1', 0.4, true);
        expect(mocks.wireSidechainRoutes.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(
            mocks.updateDeviceBypass.mock.invocationCallOrder[0] ?? 0
        );

        vi.clearAllMocks();
        projectTrackToLiveStrip({ trackId: track.id, activateDormantExternalPlugins: true });

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledOnce();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({
                pluginId: 'persisted-native-plugin',
                instanceId: 'persisted-native-instance',
                stateChunk: 'c2F2ZWQ=',
            })
        );

        // The injected latency sink writes under the engine DEVICE id, so the
        // rebuilt strip reports compensation against the same key the removal
        // path clears — not the plugin instance id.
        const activation = mocks.activateExternalPlugin.mock.calls.at(-1)?.[0] as {
            onLatencyMs?: (latencyMs: number) => void;
        };
        activation.onLatencyMs?.(7.25);
        expect(mocks.reportLatency).toHaveBeenCalledWith('device-1', 7.25);
    });

    it('keeps solo-safe and solo-bus upstream tracks audible while muting unrelated tracks', () => {
        const target = createTrack({ id: 'target', name: 'Target', kind: 'audio' });
        const soloedBus = createTrack({ id: 'bus', name: 'Bus', kind: 'bus' });
        soloedBus.soloed = true;
        const source = createTrack({ id: 'source', name: 'Source', kind: 'audio' });
        source.outputId = soloedBus.id;
        const safe = createTrack({ id: 'safe', name: 'Safe', kind: 'audio' });
        safe.soloSafe = true;
        trackStore.set({ tracks: [target, soloedBus, source, safe], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: target.id, deferSidechainWiring: true });
        projectTrackToLiveStrip({ trackId: source.id, deferSidechainWiring: true });
        projectTrackToLiveStrip({ trackId: safe.id, deferSidechainWiring: true });

        expect(mocks.setTrackMute.mock.calls).toEqual([
            ['target', true],
            ['source', false],
            ['safe', false],
        ]);
        expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();
    });

    it('ignores a soloed ambiguous owner when projecting a unique live strip', () => {
        const first = createTrack({ id: 'duplicate', name: 'First', kind: 'audio' });
        first.soloed = true;
        const second = createTrack({ id: 'duplicate', name: 'Second', kind: 'audio' });
        const unique = createTrack({ id: 'unique', name: 'Unique', kind: 'audio' });
        trackStore.set({ tracks: [first, second, unique], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: unique.id });

        expect(mocks.setTrackMute).toHaveBeenCalledWith(unique.id, false);
    });

    it('restores authoritative gain after a persisted PFL solo is cleared', () => {
        mocks.soloMode = 'pfl';
        const soloed = createTrack({ id: 'soloed', name: 'Soloed', kind: 'audio' });
        soloed.gain = 0.4;
        soloed.muted = true;
        soloed.soloed = true;
        trackStore.set({ tracks: [soloed], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: soloed.id });
        trackStore.set({ tracks: [{ ...soloed, soloed: false }], selectedTrackId: null });
        applySoloLogic();

        expect(mocks.setTrackGain.mock.calls).toEqual([
            ['soloed', 0.4],
            ['soloed', 1],
            ['soloed', 0.4],
        ]);
        expect(mocks.setTrackMute).toHaveBeenCalledWith('soloed', false);
        // FX-8 — projecting a strip also settles its solo gate, so a strip built
        // while a solo is up starts closed instead of leaking into return buses.
        // Here the only track is the soloed one, so it is never gated.
        expect(mocks.setTrackSoloGate).toHaveBeenCalledWith('soloed', false);
    });

    it('resets saved PFL gain state at project startup without runtime writes', () => {
        mocks.soloMode = 'pfl';
        const oldTrack = createTrack({ id: 'shared-id', name: 'Old', kind: 'audio' });
        oldTrack.gain = 0.4;
        oldTrack.soloed = true;
        trackStore.set({ tracks: [oldTrack], selectedTrackId: null });
        applySoloLogic();
        vi.clearAllMocks();
        const newTrack = { ...oldTrack, name: 'New', gain: 0.8, soloed: false };
        trackStore.set({ tracks: [newTrack], selectedTrackId: null });

        applySoloLogic({ resetSavedGains: true, applyActions: false });

        expect(mocks.setTrackGain).not.toHaveBeenCalled();
        expect(mocks.setTrackMute).not.toHaveBeenCalled();
    });

    it('refuses ambiguous track ownership', () => {
        const first = createTrack({ id: 'duplicate', name: 'First', kind: 'audio' });
        const second = createTrack({ id: 'duplicate', name: 'Second', kind: 'audio' });
        first.devices = [{ id: 'shared', name: 'First', type: 'delay', bypassed: false, parameterValues: {} }];
        second.devices = [{ id: 'shared', name: 'Second', type: 'delay', bypassed: false, parameterValues: {} }];
        trackStore.set({ tracks: [first, second], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: 'duplicate' });

        expect(mocks.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();
    });

    it('does not project a device with ambiguous ownership', () => {
        const owner = createTrack({ id: 'owner', name: 'Owner', kind: 'audio' });
        const other = createTrack({ id: 'other', name: 'Other', kind: 'audio' });
        owner.devices = [{ id: 'shared', name: 'First', type: 'delay', bypassed: false, parameterValues: {} }];
        other.devices = [{ id: 'shared', name: 'Second', type: 'delay', bypassed: false, parameterValues: {} }];
        trackStore.set({ tracks: [owner, other], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: owner.id });

        expect(mocks.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
    });

    it('keeps MIDI-only Yeast out of the audio graph and predecessor order', () => {
        const track = createTrack({ id: 'midi-1', name: 'MIDI', kind: 'midi' });
        track.devices = [
            { id: 'filter-1', name: 'Filter', type: 'filter', bypassed: false, parameterValues: { cutoff: 0.6 } },
            { id: 'yeast-1', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: { chance: 0.75 } },
            { id: 'delay-1', name: 'Delay', type: 'delay', bypassed: false, parameterValues: { mix: 0.4 } },
        ];
        trackStore.set({ tracks: [track], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: track.id });

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [
                    expect.objectContaining({
                        devices: [
                            { id: 'filter-1', type: 'filter', parameterIds: ['cutoff'] },
                            { id: 'delay-1', type: 'delay', parameterIds: ['mix'] },
                        ],
                    }),
                ],
            })
        );
        expect(mocks.updateDeviceParam.mock.calls).toEqual([
            ['midi-1', 'filter-1', 'cutoff', 0.6],
            ['midi-1', 'delay-1', 'mix', 0.4],
        ]);
        expect(mocks.updateDeviceBypass.mock.calls).toEqual([
            ['midi-1', 'filter-1', false],
            ['midi-1', 'delay-1', false],
        ]);
    });

    it('projects a Toaster folder but leaves an ordinary folder dormant', () => {
        const dormant = createTrack({ id: 'folder', name: 'Folder', kind: 'folder' });
        const toaster = createTrack({ id: 'toaster', name: 'Toaster', kind: 'folder' });
        toaster.devices = [
            { id: 'toaster-device', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        trackStore.set({ tracks: [dormant, toaster], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: dormant.id });
        projectTrackToLiveStrip({ trackId: toaster.id });

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledOnce();
        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [
                    expect.objectContaining({
                        id: toaster.id,
                        devices: [{ id: 'toaster-device', type: 'toaster', parameterIds: [] }],
                    }),
                ],
            })
        );
    });

    it.each(initializationFailureResults)(
        'returns the exact initialization outcome and stops later projection effects',
        (initializationResult) => {
            const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
            track.devices = [
                { id: 'delay-1', name: 'Delay', type: 'delay', bypassed: false, parameterValues: { mix: 0.4 } },
            ];
            trackStore.set({ tracks: [track], selectedTrackId: null });
            mocks.initializeTrackStripFromSnapshot.mockReturnValue(initializationResult);

            const result = projectTrackToLiveStrip({ trackId: track.id });

            expect(result).toBe(initializationResult);
            expect(mocks.setTrackGain).not.toHaveBeenCalled();
            expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
            expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();
        }
    );

    it('projects Toaster pad ownership independently from the audible output', () => {
        const toaster = createTrack({ id: 'toaster', name: 'Toaster', kind: 'folder' });
        toaster.devices = [
            { id: 'toaster-device', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        const firstPad = createTrack({ id: 'pad-1', name: 'Pad 1', kind: 'audio' });
        firstPad.parentId = toaster.id;
        const routedPad = createTrack({ id: 'pad-2', name: 'Pad 2', kind: 'audio' });
        routedPad.parentId = toaster.id;
        routedPad.outputId = 'return-bus';
        mocks.resolveToasterPadBinding.mockReturnValue({ toasterParentTrackId: toaster.id, padIndex: 1 });
        trackStore.set({ tracks: [toaster, firstPad, routedPad], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: routedPad.id });

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                output: {
                    kind: 'output',
                    sourceId: routedPad.id,
                    targetId: 'return-bus',
                    padBinding: { toasterParentTrackId: toaster.id, padIndex: 1 },
                },
            })
        );
    });

    it('skips resolved routing targets that cannot own audio endpoints', () => {
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        const vca = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(vca, 'kind', { value: 'vca' });
        track.outputId = vca.id;
        track.sends = [{ busId: vca.id, level: 0.5, preFader: false }];
        trackStore.set({ tracks: [track, vca], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: track.id });

        expect(mocks.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
    });

    it('skips output and send wiring when the routing endpoint is ambiguous', () => {
        // Two tracks share the output id: acceptsRoutingEndpoint cannot pick a
        // unique owner, so neither the output nor the send is wired.
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        const firstMaster = createTrack({ id: 'master', name: 'First', kind: 'master' });
        const secondMaster = createTrack({ id: 'master', name: 'Second', kind: 'master' });
        track.outputId = firstMaster.id;
        track.sends = [{ busId: firstMaster.id, level: 0.5, preFader: false }];
        trackStore.set({ tracks: [track, firstMaster, secondMaster], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: track.id });

        expect(mocks.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
    });

    it('is a no-op when the track store has not loaded', () => {
        trackStore.set(null);

        projectTrackToLiveStrip({ trackId: 'audio-1' });

        expect(mocks.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();
    });
});
