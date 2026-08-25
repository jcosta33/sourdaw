import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { ensureTrackStrips } from '../ensureTrackStrips';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null as TrackStoreState | null },
    ensureTrackStrip: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    ensureBusStrip: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    wireSidechainRoutes: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
    applySoloLogic: mocks.applySoloLogic,
}));

// Mock the barrel re-exports but satisfy the markerStore etc. if needed by other components
vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: (kind: string | undefined) => ({
        acceptsRoutingEndpoint: kind !== undefined && ['audio', 'midi', 'bus', 'master', 'folder'].includes(kind),
        createsLiveStrip: kind !== 'folder' && kind !== 'vca' && kind !== undefined,
    }),
    shouldCreateLiveTrackStrip: (track: { kind: string | undefined; devices: readonly { type: string }[] }) => {
        if (track.kind !== 'folder') {
            return track.kind !== 'vca' && track.kind !== undefined;
        }
        return track.devices.some((device) => device.type === 'toaster');
    },
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
        subscribe: vi.fn(() => () => {}),
    },
    resolveEligibleDeviceWriteTarget: (deviceId: string) => {
        const track = mocks.trackStoreValue.value?.tracks.find((candidate) =>
            candidate.devices.some((device) => device.id === deviceId)
        );
        if (!track) {
            return { status: 'missing' };
        }
        return { status: 'eligible', trackId: track.id, deviceId };
    },
    markerStore: { value: { markers: [], sections: [] } },
    chordTrackStore: { value: {} },
    scratchPadStore: { value: {} },
    takeLaneStore: { value: {} },
    persistDeviceParam: vi.fn(),
}));

// Mock AudioEngine use cases
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: mocks.ensureTrackStrip,
    setTrackOutput: mocks.setTrackOutput,
    setTrackGain: mocks.setTrackGain,
    setTrackPan: mocks.setTrackPan,
    setTrackMute: mocks.setTrackMute,
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
    // Add other common exports to satisfy the barrel mock
    resumeEngine: vi.fn(),
    getAudioContext: vi.fn(),
    stopAllScheduled: vi.fn(),
    resetMidiState: vi.fn(),
    scheduleClick: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
}));

// Mock Routing use cases
vi.mock('#/modules/Routing/useCases', () => ({
    ensureBusStrip: mocks.ensureBusStrip,
    setBusGain: mocks.setBusGain,
    setSend: mocks.setSend,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

describe('ensureTrackStrips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bootstraps tracks and their components in the engine', () => {
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 't1', kind: 'audio' }),
                    gain: 0.8,
                    pan: -10,
                    muted: false,
                    soloed: false,
                    outputId: 'main',
                    devices: [
                        { id: 'd1', name: 'reverb', type: 'reverb', bypassed: false, parameterValues: { room: 0.5 } },
                    ],
                    sends: [{ busId: 'b1', level: 0.1, preFader: false }],
                },
                {
                    ...createTrack({ id: 'b1', name: 'b1', kind: 'bus' }),
                    gain: 1.0,
                    pan: 0,
                    muted: false,
                    soloed: false,
                    outputId: 'main',
                    devices: [],
                    sends: [],
                },
            ],
        };

        ensureTrackStrips();

        expect(mocks.ensureBusStrip).toHaveBeenCalledWith('b1');
        expect(mocks.applySoloLogic).toHaveBeenCalledWith({ resetSavedGains: true, applyActions: false });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(1, {
            trackId: 't1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(2, {
            trackId: 'b1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
    });

    it('initializes output owners before their dependent Toaster strips without empty-strip publication', () => {
        const toasterFolder = createTrack({ id: 'toaster-folder', name: 'Toaster Kit', kind: 'folder' });
        const ordinaryFolder = createTrack({ id: 'ordinary-folder', name: 'Group', kind: 'folder' });
        const effectsBus = createTrack({ id: 'effects-bus', name: 'Effects', kind: 'bus' });
        const masterTrack = createTrack({ id: 'master-track', name: 'Master', kind: 'master' });
        toasterFolder.outputId = masterTrack.id;
        effectsBus.outputId = masterTrack.id;
        masterTrack.outputId = 'hw_out';
        toasterFolder.devices = [
            {
                id: 'toaster-device',
                name: 'Toaster',
                type: 'toaster',
                bypassed: false,
                parameterValues: {},
            },
        ];
        const children = Array.from({ length: 16 }, (_, padIndex) => {
            const child = createTrack({
                id: `toaster-pad-${padIndex}`,
                name: `Pad ${padIndex + 1}`,
                kind: 'midi',
                parentId: toasterFolder.id,
            });
            child.devices = [];
            child.outputId = toasterFolder.id;
            return child;
        });
        children[0]!.sends = [{ busId: effectsBus.id, level: 0.25, preFader: false }];
        mocks.trackStoreValue.value = {
            selectedTrackId: toasterFolder.id,
            tracks: [...children, ordinaryFolder, toasterFolder, effectsBus, masterTrack],
        };
        const initializationTrackIds = [
            masterTrack.id,
            toasterFolder.id,
            ...children.map((child) => child.id),
            effectsBus.id,
        ];

        function expectReconstruction(): void {
            expect(mocks.ensureTrackStrip).not.toHaveBeenCalled();
            expect(mocks.projectTrackToLiveStrip.mock.calls).toEqual(
                initializationTrackIds.map((trackId) => [
                    { trackId, deferSidechainWiring: true, activateDormantExternalPlugins: true },
                ])
            );
            expect(mocks.wireSidechainRoutes).toHaveBeenCalledTimes(1);

            expect(Math.max(...mocks.ensureBusStrip.mock.invocationCallOrder)).toBeLessThan(
                Math.min(...mocks.projectTrackToLiveStrip.mock.invocationCallOrder)
            );
            expect(Math.max(...mocks.projectTrackToLiveStrip.mock.invocationCallOrder)).toBeLessThan(
                mocks.wireSidechainRoutes.mock.invocationCallOrder[0] ?? 0
            );
        }

        ensureTrackStrips();
        expectReconstruction();

        vi.clearAllMocks();
        ensureTrackStrips();
        expectReconstruction();
    });

    it('wires persisted sidechain routes into the engine after strips exist', () => {
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 't1', kind: 'audio' }),
                    devices: [],
                    sends: [],
                },
            ],
        };

        ensureTrackStrips();

        expect(mocks.wireSidechainRoutes).toHaveBeenCalledTimes(1);
    });

    it('fails closed before bus or sidechain projection when a bus id is ambiguous', () => {
        const first = createTrack({ id: 'duplicate-bus', name: 'First', kind: 'bus' });
        const second = createTrack({ id: 'duplicate-bus', name: 'Second', kind: 'bus' });
        mocks.trackStoreValue.value = { selectedTrackId: null, tracks: [first, second] };

        ensureTrackStrips();

        expect(mocks.ensureBusStrip).not.toHaveBeenCalled();
        expect(mocks.setBusGain).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();
    });

    it('does not allocate or replay a strip for a dormant VCA', () => {
        const dormantVca = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(dormantVca, 'kind', { value: 'vca' });
        dormantVca.devices = [{ id: 'd1', name: 'Device', type: 'device', bypassed: false, parameterValues: {} }];
        dormantVca.sends = [{ busId: 'b1', level: 0.5, preFader: false }];
        mocks.trackStoreValue.value = { selectedTrackId: null, tracks: [dormantVca] };

        ensureTrackStrips();

        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
    });

    it('allocates a strip for a Toaster folder but not an ordinary folder', () => {
        const ordinaryFolder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        ordinaryFolder.soloed = true;
        const toasterFolder = createTrack({ id: 'toaster-1', name: 'Toaster', kind: 'folder' });
        toasterFolder.devices = [
            { id: 'toaster-device', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [ordinaryFolder, toasterFolder],
        };

        ensureTrackStrips();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledOnce();
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'toaster-1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
    });

    it('delegates resolved dormant-VCA routing validation to the Arrangement projector', () => {
        const dormantVca = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(dormantVca, 'kind', { value: 'vca' });
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' }),
                    outputId: 'vca-1',
                    sends: [{ busId: 'vca-1', level: 0.5, preFader: false }],
                },
                dormantVca,
            ],
        };

        ensureTrackStrips();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'audio-1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
    });

    it('delegates resolved malformed-target validation to the Arrangement projector', () => {
        const malformedTarget = createTrack({ id: 'malformed-1', name: 'Malformed', kind: 'audio' });
        Object.defineProperty(malformedTarget, 'kind', { value: undefined });
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' }),
                    outputId: 'malformed-1',
                    sends: [{ busId: 'malformed-1', level: 0.5, preFader: false }],
                },
                malformedTarget,
            ],
        };

        ensureTrackStrips();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'audio-1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
    });
});
