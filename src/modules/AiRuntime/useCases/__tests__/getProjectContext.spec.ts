import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    getProjectContext,
    type ProjectContextSidechainRoute,
    type ProjectContextVcaGroup,
} from '../getProjectContext';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as any,
    midiStoreValue: { value: null } as any,
    transportStoreValue: { value: null } as any,
    workspaceStoreValue: { value: null } as any,
    clipSelectionStoreValue: { value: null } as any,
    automationStoreValue: { value: null } as any,
    sidechainStoreValue: { value: null as { routes: ProjectContextSidechainRoute[] } | null },
    vcaStoreValue: { value: null as { groups: ProjectContextVcaGroup[] } | null },
    getPluginById: vi.fn(),
    getPlatformPlugins: vi.fn(),
    getGlueEligibleClipPairs: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
    clipSelectionStore: {
        get value() {
            return mocks.clipSelectionStoreValue.value;
        },
    },
    vcaGroupStore: {
        get value() {
            return mocks.vcaStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getGlueEligibleClipPairs: mocks.getGlueEligibleClipPairs,
    getPluginById: mocks.getPluginById,
    getPlatformPlugins: mocks.getPlatformPlugins,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: {
        get value() {
            return mocks.sidechainStoreValue.value;
        },
    },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStoreValue.value;
        },
    },
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
    },
}));

describe('getProjectContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.transportStoreValue.value = null;
        mocks.workspaceStoreValue.value = null;
        mocks.clipSelectionStoreValue.value = null;
        mocks.automationStoreValue.value = null;
        mocks.sidechainStoreValue.value = null;
        mocks.vcaStoreValue.value = null;
        mocks.getPluginById.mockReturnValue(undefined);
        mocks.getGlueEligibleClipPairs.mockReturnValue([]);
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'builtin-eq', name: 'EQ' },
            { id: 'crust', name: 'Crust' },
        ]);
    });

    it('projects glue eligibility and invalidates the cache when hidden eligibility changes', () => {
        const first = getProjectContext();
        mocks.getGlueEligibleClipPairs.mockReturnValue([['clip-a', 'clip-b']]);

        const second = getProjectContext();

        expect(first.glueEligibleClipPairs).toEqual([]);
        expect(second.glueEligibleClipPairs).toEqual([['clip-a', 'clip-b']]);
        expect(second).not.toBe(first);
    });

    it('returns context with default values when stores are empty', () => {
        const context = getProjectContext();

        expect(context.tempo).toBe(120);
        expect(context.timeSignature).toEqual([4, 4]);
        expect(context.isPlaying).toBe(false);
        expect(context.isLooping).toBe(false);
        expect(context.loopStart).toBe(0);
        expect(context.loopEnd).toBe(0);
        expect(context.metronomeEnabled).toBe(false);
        expect(context.metronomeVolume).toBe(0.5);
        expect(context.masterGain).toBe(0.8);
        expect(context.availableDeviceTypes).toEqual([{ id: 'builtin-eq', name: 'EQ' }]);
        expect(context.automationLanes).toEqual([]);
        expect(context.sidechainRoutes).toEqual([]);
        expect(context.vcaGroups).toEqual([]);
        expect(context).not.toHaveProperty('markers');
        expect(context.tracks).toEqual([]);
        expect(context.selectedTrackId).toBeNull();
        expect(context.selectedClipId).toBeNull();
        expect(context.selectedClipIds).toEqual([]);
        expect(context.activeView).toBe('arrange');
        expect(context.playheadPosition).toBe(0);
    });

    it('maps track, clip, and device properties correctly', () => {
        mocks.trackStoreValue.value = {
            selectedTrackId: 't1',
            tracks: [
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    armed: false,
                    gain: 0.8,
                    pan: -10,
                    automationMode: 'touch',
                    outputId: 'master',
                    vcaGroupId: 'vca-drums',
                    clips: [
                        {
                            id: 'c1',
                            name: 'Vox 1',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                            gain: 1.2,
                            locked: false,
                            muted: true,
                            color: '#ff5500',
                            fadeInBeats: 0.5,
                            fadeOutBeats: 1,
                            loopEnabled: true,
                        },
                    ],
                    devices: [
                        {
                            id: 'd1',
                            type: 'EQ',
                            bypassed: false,
                            parameterValues: { frequency: 1200, hidden: 0.5 },
                        },
                    ],
                    sends: [{ busId: 'bus-1', level: 0.3, preFader: false }],
                },
                {
                    id: 't2',
                    name: 'Synth',
                    kind: 'midi',
                    muted: true,
                    soloed: false,
                    armed: true,
                    gain: 1.0,
                    pan: 0,
                    outputId: 'bus-1',
                    clips: [{ id: 'c2', name: 'Chords', type: 'midi', startBeat: 4, endBeat: 8 }],
                    devices: [],
                    sends: [],
                },
            ],
        };

        mocks.midiStoreValue.value = {
            notesByClipId: {
                c2: [{}, {}, {}], // 3 notes
            },
        };

        mocks.transportStoreValue.value = {
            tempo: 130,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 4,
            playheadPosition: 16,
            isPlaying: true,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.25,
            masterGain: 65,
        };

        mocks.clipSelectionStoreValue.value = {
            selectedClipId: 'c2',
            selectedClipIds: ['c2'],
        };
        mocks.workspaceStoreValue.value = { mode: 'mix' };
        mocks.getPluginById.mockImplementation((pluginId: string) =>
            pluginId === 'EQ'
                ? {
                      parameters: [
                          {
                              id: 'frequency',
                              name: 'Frequency',
                              type: 'float',
                              minValue: 20,
                              maxValue: 20_000,
                              unit: 'Hz',
                          },
                      ],
                  }
                : undefined
        );

        const context = getProjectContext();

        expect(context.tempo).toBe(130);
        expect(context.timeSignature).toEqual([3, 4]);
        expect(context.isPlaying).toBe(true);
        expect(context.isLooping).toBe(true);
        expect(context.loopStart).toBe(4);
        expect(context.loopEnd).toBe(12);
        expect(context.metronomeEnabled).toBe(true);
        expect(context.metronomeVolume).toBe(0.25);
        expect(context.masterGain).toBe(0.65);
        expect(context.selectedTrackId).toBe('t1');
        expect(context.selectedClipId).toBe('c2');
        expect(context.selectedClipIds).toEqual(['c2']);
        expect(context.activeView).toBe('mix');
        expect(context.playheadPosition).toBe(16);

        expect(context.tracks).toHaveLength(2);

        // First track (audio)
        expect(context.tracks[0]).toMatchObject({
            id: 't1',
            name: 'Vocals',
            kind: 'audio',
            muted: false,
            soloed: true,
            armed: false,
            gain: 0.8,
            pan: -10,
            automationMode: 'touch',
            outputId: 'master',
            vcaGroupId: 'vca-drums',
            clipCount: 1,
            deviceCount: 1,
        });
        expect(context.tracks[0]?.clips[0]).toEqual({
            id: 'c1',
            name: 'Vox 1',
            type: 'audio',
            startBeat: 0,
            endBeat: 4,
            gain: 1.2,
            locked: false,
            muted: true,
            color: '#ff5500',
            fadeInBeats: 0.5,
            fadeOutBeats: 1,
            loopEnabled: true,
            noteCount: 0,
        });
        expect(context.tracks[0]?.devices[0]).toEqual({
            id: 'd1',
            type: 'EQ',
            bypassed: false,
            parameters: [
                {
                    id: 'frequency',
                    name: 'Frequency',
                    type: 'float',
                    value: 1200,
                    minValue: 20,
                    maxValue: 20_000,
                    unit: 'Hz',
                },
            ],
        });
        expect(context.tracks[0]?.sends).toEqual([{ busId: 'bus-1', level: 0.3, preFader: false }]);

        // Second track (midi)
        expect(context.tracks[1]?.clips[0]).toMatchObject({
            id: 'c2',
            type: 'midi',
            noteCount: 3,
        });
    });

    it('maps bounded sidechain routes and invalidates the cache when routing state changes', () => {
        mocks.sidechainStoreValue.value = {
            routes: [
                {
                    id: 'route-kick-bass',
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass',
                    targetDeviceId: 'device-sidechain',
                    targetParameterId: 'threshold',
                    gain: 0.75,
                },
            ],
        };

        const first = getProjectContext();
        expect(first.sidechainRoutes).toEqual(mocks.sidechainStoreValue.value.routes);

        mocks.sidechainStoreValue.value = { routes: [] };
        const second = getProjectContext();

        expect(second).not.toBe(first);
        expect(second.sidechainRoutes).toEqual([]);
    });

    it('maps automation lanes with clip ownership and invalidates the cache when automation state changes', () => {
        mocks.automationStoreValue.value = {
            lanes: [
                {
                    id: 'lane-gain',
                    trackId: 'track-vocals',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { beat: 0, value: 0.4, curve: 'linear', tension: 0 },
                        { beat: 8, value: 0.8, curve: 'smooth', tension: 0.2 },
                    ],
                },
                {
                    id: 'lane-clip-gain',
                    trackId: 'track-vocals',
                    clipId: 'clip-verse',
                    parameterId: 'gain',
                    parameterName: 'Clip Gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [{ beat: 0, value: 1, curve: 'linear', tension: 0 }],
                },
            ],
        };

        const first = getProjectContext();

        expect(first.automationLanes).toEqual([
            {
                id: 'lane-gain',
                trackId: 'track-vocals',
                parameterId: 'gain',
                name: 'Gain',
                enabled: true,
                minValue: 0,
                maxValue: 1,
                points: [
                    { beat: 0, value: 0.4, curve: 'linear' },
                    { beat: 8, value: 0.8, curve: 'smooth' },
                ],
            },
            {
                id: 'lane-clip-gain',
                trackId: 'track-vocals',
                clipId: 'clip-verse',
                parameterId: 'gain',
                name: 'Clip Gain',
                enabled: true,
                minValue: 0,
                maxValue: 1,
                points: [{ beat: 0, value: 1, curve: 'linear' }],
            },
        ]);

        mocks.automationStoreValue.value = {
            lanes: [
                {
                    ...mocks.automationStoreValue.value.lanes[0],
                    enabled: false,
                },
            ],
        };

        const second = getProjectContext();

        expect(second).not.toBe(first);
        expect(second.automationLanes?.[0]?.enabled).toBe(false);
    });

    it('maps VCA groups and invalidates the cache when VCA state changes', () => {
        mocks.vcaStoreValue.value = {
            groups: [{ id: 'vca-drums', name: 'Drums', gain: 0.75, muted: false, trackIds: ['track-kick'] }],
        };

        const first = getProjectContext();
        expect(first.vcaGroups).toEqual(mocks.vcaStoreValue.value.groups);

        mocks.vcaStoreValue.value = {
            groups: [{ ...mocks.vcaStoreValue.value.groups[0]!, gain: 0.6 }],
        };
        const second = getProjectContext();

        expect(second).not.toBe(first);
        expect(second.vcaGroups?.[0]?.gain).toBe(0.6);
    });
});
