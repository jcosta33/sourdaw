import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import {
    getProjectContext,
    type ProjectContextAdjustmentLayer,
    type ProjectContextSection,
    type ProjectContextSidechainRoute,
    type ProjectContextVcaGroup,
} from '../getProjectContext';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: unknown } = { value: null };
    const midiStoreValue: { value: unknown } = { value: null };
    const transportStoreValue: { value: unknown } = { value: null };
    const workspaceStoreValue: { value: unknown } = { value: null };
    const clipSelectionStoreValue: { value: unknown } = { value: null };
    const automationStoreValue: { value: unknown } = { value: null };
    const adjustmentLayerStoreValue: { value: { layers: ProjectContextAdjustmentLayer[] } | null } = { value: null };
    const sidechainStoreValue: { value: { routes: ProjectContextSidechainRoute[] } | null } = { value: null };
    const markerStoreValue: { value: { sections: ProjectContextSection[] } | null } = { value: null };
    const vcaStoreValue: { value: { groups: ProjectContextVcaGroup[] } | null } = { value: null };
    const projectStoreValue: { value: unknown } = { value: null };
    const repairStateStoreValue: { value: unknown } = { value: null };
    return {
        trackStoreValue,
        midiStoreValue,
        transportStoreValue,
        workspaceStoreValue,
        clipSelectionStoreValue,
        automationStoreValue,
        adjustmentLayerStoreValue,
        sidechainStoreValue,
        markerStoreValue,
        vcaStoreValue,
        projectStoreValue,
        repairStateStoreValue,
        getPluginById: vi.fn(),
        getPlatformPlugins: vi.fn(),
        getGlueEligibleClipPairs: vi.fn(),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
    },
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
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
    },
    // Reached only through the graph `#/modules/Automation/useCases` pulls in
    // for `getAutomationLaneCeiling`; this spec never exercises it, but a
    // barrel factory replaces the whole module, so an omitted name is a
    // resolution failure rather than an unused stub.
    resolveEligibleDeviceWriteTarget: () => null,
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

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: {
        get value() {
            return mocks.repairStateStoreValue.value;
        },
    },
    // Same reason as the Arrangement factory above: these names are reached
    // through the graph behind `#/modules/Automation/useCases`, and a barrel
    // factory that omits one fails to resolve rather than leaving it real.
    actionHistoryStore: { value: null },
    clearSemanticContext: () => {},
    setSemanticContext: () => {},
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

vi.mock('#/modules/Project/stores', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
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
        mocks.adjustmentLayerStoreValue.value = null;
        mocks.sidechainStoreValue.value = null;
        mocks.markerStoreValue.value = null;
        mocks.vcaStoreValue.value = null;
        mocks.projectStoreValue.value = null;
        mocks.repairStateStoreValue.value = null;
        mocks.getPluginById.mockReturnValue(undefined);
        mocks.getGlueEligibleClipPairs.mockReturnValue([]);
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'builtin-eq', name: 'EQ' },
            { id: 'crust', name: 'Crust' },
        ]);
    });

    it('withholds all model context while raw collaborative truth requires repair', () => {
        mocks.repairStateStoreValue.value = { status: 'repair-required' };

        expect(() => getProjectContext()).toThrow('unresolved collaborative state');
    });

    it('projects glue eligibility and invalidates the cache when hidden eligibility changes', () => {
        const first = getProjectContext();
        mocks.getGlueEligibleClipPairs.mockReturnValue([['clip-a', 'clip-b']]);

        const second = getProjectContext();

        expect(first.glueEligibleClipPairs).toEqual([]);
        expect(second.glueEligibleClipPairs).toEqual([['clip-a', 'clip-b']]);
        expect(second).not.toBe(first);
    });

    it('projects the current production brief and invalidates the cache when its revision changes', () => {
        const productionBrief = {
            schemaVersion: 1,
            id: 'production-brief',
            revision: 3,
            vision: 'Intimate verses, explosive choruses',
            references: [],
            hardConstraints: [],
            preferences: [],
            sectionGoals: [],
            trackRoles: [],
            locks: [],
            decisions: [],
            unresolvedQuestions: [],
            sourceRunLinks: [{ id: 'source-link-3', sourceRunId: 'run-3', createdAt: 102 }],
            supersedesBriefId: null,
            supersededByBriefId: null,
            createdAt: 100,
            updatedAt: 120,
        };
        mocks.projectStoreValue.value = { productionBrief };

        const first = getProjectContext();
        expect(first.productionBrief).toEqual(productionBrief);

        mocks.projectStoreValue.value = {
            productionBrief: { ...productionBrief, revision: 4, updatedAt: 130 },
        };
        const second = getProjectContext();

        expect(second.productionBrief?.revision).toBe(4);
        expect(second).not.toBe(first);
    });

    it('returns context with default values when stores are empty', () => {
        const context = getProjectContext();

        expect(context.tempo).toBe(120);
        expect(context.timeSignature).toEqual([4, 4]);
        expect(context.isPlaying).toBe(false);
        expect(context.isRecording).toBe(false);
        expect(context.isLooping).toBe(false);
        expect(context.loopStart).toBe(0);
        expect(context.loopEnd).toBe(0);
        expect(context.punchInEnabled).toBe(false);
        expect(context.punchInBeat).toBe(0);
        expect(context.punchOutBeat).toBe(16);
        expect(context.metronomeEnabled).toBe(false);
        expect(context.metronomeVolume).toBe(0.5);
        expect(context.masterGain).toBe(0.8);
        expect(context.availableDeviceTypes).toEqual([{ id: 'builtin-eq', name: 'EQ' }]);
        expect(context.adjustmentLayers).toEqual([]);
        expect(context.automationLanes).toEqual([]);
        expect(context.sidechainRoutes).toEqual([]);
        expect(context.sections).toEqual([]);
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
                            loopLength: 2,
                        },
                    ],
                    activeAlternativeId: 'alt-active',
                    alternatives: [
                        { id: 'alt-active', name: 'Active', clips: [{ id: 'c1' }] },
                        { id: 'alt-hidden', name: 'Hidden take', clips: [{ id: 'c-hidden' }] },
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
                    alternatives: [],
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
            isRecording: false,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            punchInEnabled: true,
            punchInBeat: 6,
            punchOutBeat: 10,
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
        expect(context.isRecording).toBe(false);
        expect(context.isLooping).toBe(true);
        expect(context.loopStart).toBe(4);
        expect(context.loopEnd).toBe(12);
        expect(context.punchInEnabled).toBe(true);
        expect(context.punchInBeat).toBe(6);
        expect(context.punchOutBeat).toBe(10);
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
            alternativeClipIds: ['c1', 'c-hidden'],
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
            loopLength: 2,
            minimumLoopLengthBeats: 1 / 480,
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
        const gainLane = {
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
        };
        mocks.automationStoreValue.value = {
            lanes: [
                gainLane,
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
                // The ceiling this track-gain lane really has, not the `1` the
                // document stores. Written before the fader gained its `+6 dB`
                // of headroom, it still records unity — and a provider handed
                // that scalar is told the lane cannot reach a value the fader
                // plainly can, so `addAutomationPoint` refuses the ride the user
                // asked for on an old project and takes it on a new one.
                maxValue: FADER_MAX_GAIN,
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
                // Untouched at `1`: a clip's own gain is not a fader, and the
                // headroom the strip gained says nothing about it.
                maxValue: 1,
                points: [{ beat: 0, value: 1, curve: 'linear' }],
            },
        ]);

        mocks.automationStoreValue.value = {
            lanes: [
                {
                    ...gainLane,
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

    it('maps arrangement sections and invalidates the cache when their bounds change', () => {
        mocks.markerStoreValue.value = {
            sections: [{ id: 'section-verse-two', name: 'Verse Two', startBeat: 16, endBeat: 32 }],
        };

        const first = getProjectContext();
        expect(first.sections).toEqual(mocks.markerStoreValue.value.sections);

        mocks.markerStoreValue.value = {
            sections: [{ ...mocks.markerStoreValue.value.sections[0]!, endBeat: 36 }],
        };
        const second = getProjectContext();

        expect(second).not.toBe(first);
        expect(second.sections?.[0]?.endBeat).toBe(36);
    });

    it('maps adjustment layers and invalidates the cache when their regions change', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'layer-bass-eq',
                    name: 'Bass Chorus EQ',
                    effectType: 'eq',
                    parameters: [{ name: 'Low Mid Gain', value: -2, min: -12, max: 12, unit: 'dB' }],
                    affectedTrackIds: ['track-bass'],
                    insertionIndex: 0,
                    regions: [
                        {
                            id: 'region-chorus-one',
                            startBeat: 16,
                            endBeat: 32,
                            blend: 0.75,
                            fadeInBeats: 0.5,
                            fadeOutBeats: 0.25,
                        },
                    ],
                    enabled: true,
                    mix: 0.8,
                    color: '#6f7cff',
                },
            ],
        };

        const first = getProjectContext();
        expect(first.adjustmentLayers).toEqual(mocks.adjustmentLayerStoreValue.value.layers);

        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    ...mocks.adjustmentLayerStoreValue.value.layers[0]!,
                    regions: [
                        ...mocks.adjustmentLayerStoreValue.value.layers[0]!.regions,
                        {
                            id: 'region-chorus-two',
                            startBeat: 48,
                            endBeat: 64,
                            blend: 0.75,
                            fadeInBeats: 0.5,
                            fadeOutBeats: 0.25,
                        },
                    ],
                },
            ],
        };

        const second = getProjectContext();
        expect(second).not.toBe(first);
        expect(second.adjustmentLayers?.[0]?.regions).toHaveLength(2);
    });
});
