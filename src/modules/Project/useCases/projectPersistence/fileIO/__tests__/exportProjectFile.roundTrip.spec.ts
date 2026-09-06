import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { exportCachedAudioBuffers } from '#/modules/AudioEngine/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    createCrdtDoc,
    hasCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { installFakeIndexedDb } from '../../../../__tests__/fakeIndexedDb';
import { NAMED_PROJECT_KEY_PREFIX, type ProjectData } from '../../../../models/ProjectData';
import { downloadProjectFile } from '../../../../repositories/project/downloadProjectFile';
import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { saveProject } from '../../saveProject/saveProject';
import { buildProjectData } from '../buildProjectData';
import { exportProjectFile } from '../exportProjectFile';

// Heavy / side-effecting boundaries — stubbed so the export runs deterministically
// against the real stores we seed below. vi.mock is hoisted above these imports.
vi.mock('../../../../repositories/project/downloadProjectFile', () => ({
    downloadProjectFile: vi.fn(() => Promise.resolve('written' as const)),
}));
vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({
    addSidechainRouteSnapshot: vi.fn(),
    ensureBusStrip: vi.fn(),
    getAllSidechainRoutes: () => [],
    getSidechainRoutesForTrack: vi.fn(),
    getSidechainTargetCapability: vi.fn(),
    hydrateSidechainRoutes: vi.fn(),
    removeSend: vi.fn(),
    removeSidechainRoute: vi.fn(),
    removeSidechainRouteSnapshot: vi.fn(),
    restoreSidechainRoutes: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    wireSidechainRoutes: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    exportCachedAudioBuffers: vi.fn().mockResolvedValue({}),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    ensureCachedAudioBuffersDurable: vi.fn(() =>
        Promise.resolve({ status: 'durable' as const, isCurrent: () => true, release: vi.fn() })
    ),
    getAudioContext: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
const persistCrdtProjectMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    persistCrdtProject: persistCrdtProjectMock,
}));

function written(): ProjectData {
    return vi.mocked(downloadProjectFile).mock.calls[0]?.[0].data as ProjectData;
}

function seedSavableProject(createdAt: number): void {
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        createdAt,
        dirty: true,
        loading: false,
        name: 'Repair Required',
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
        updatedAt: createdAt,
    });
}

function configurePassingProjectInspection(): void {
    agentProjectInspectionPort.setProvider(() => ({
        audioGraphValid: true,
        projectInvariantsValid: true,
        targetFingerprints: {},
    }));
}

function replaceRootWithMalformedAdjustmentLayers(): void {
    if (hasCrdtDoc('root')) {
        removeCrdtDoc('root');
    }
    createCrdtDoc('root');
    mutateCrdtDoc<Record<string, unknown>>({
        id: 'root',
        changeFn: (draft) => {
            draft.adjustmentLayers = {
                layers: [
                    {
                        id: 'layer-foreign',
                        name: 'Foreign layer',
                        effectType: 'eq',
                        parameters: [
                            {
                                name: 'Low Gain',
                                value: 0,
                                min: -12,
                                max: 12,
                                unit: 'dB',
                                futurePeerField: true,
                            },
                        ],
                        affectedTrackIds: [],
                        insertionIndex: 0,
                        regions: [],
                        enabled: true,
                        mix: 0.5,
                        color: '#ffffff',
                    },
                ],
            };
        },
    });
}

describe('exportProjectFile round-trip shape', () => {
    beforeEach(() => {
        vi.mocked(downloadProjectFile).mockClear();
        vi.mocked(notifyUser).mockClear();
        vi.mocked(exportCachedAudioBuffers).mockClear();
        vi.mocked(exportCachedAudioBuffers).mockResolvedValue({});
        persistCrdtProjectMock.mockReset();
        persistCrdtProjectMock.mockResolvedValue(undefined);
        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: 'track-audio',
                    name: 'Audio',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'clip-a',
                            trackId: 'track-audio',
                            name: 'take',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            audioBufferId: 'buf-1',
                            audioOffsetBeats: 2,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                        },
                    ],
                }),
            ],
            selectedTrackId: null,
        });
        midiStore.set({
            probabilitySeed: 3_735_928_559,
            notesByClipId: {
                'clip-midi': [{ id: 'note-1', pitch: 64, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: { 'clip-midi': [{ id: 'cc-1', controller: 1, value: 50, beat: 0, channel: 0 }] },
            pitchBendByClipId: {},
        });
        transportStore.set({ ...transportStore.value!, tempo: 99 });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    afterEach(() => {
        agentProjectInspectionPort.setProvider(null);
        agentProjectRepairStateStore.set(null);
        if (hasCrdtDoc('root')) {
            removeCrdtDoc('root');
        }
        trackStore.set({ tracks: [], selectedTrackId: null });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({ ...defaultTransportState });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        projectStore.set(structuredClone(defaultProjectStoreState));
        vi.unstubAllGlobals();
    });

    it('writes the serialized bufferId/sampleStartBeat — not the runtime audioBufferId', async () => {
        await exportProjectFile();

        const clip = written().arrangement.tracks[0]?.clips[0];
        expect(clip?.bufferId).toBe('buf-1');
        expect(clip?.sampleStartBeat).toBe(2);
        expect((clip as Record<string, unknown>).audioBufferId).toBeUndefined();
    });

    it('populates the exported MIDI maps from the MIDI store (no longer hard-coded empty)', async () => {
        await exportProjectFile();

        const midi = written().midi;
        expect(midi.notesByClipId['clip-midi']?.[0]?.pitch).toBe(64);
        expect(midi.ccByClipId['clip-midi']?.[0]?.controller).toBe(1);
        expect(midi.probabilitySeed).toBe(3_735_928_559);
    });

    it('writes the live transport tempo into the export', async () => {
        await exportProjectFile();
        expect(written().transport.tempo).toBe(99);
    });

    it('should export cached audio buffers collected from current tracks and all arrangements', async () => {
        const current_track = normalizeTrack({
            id: 'track-current',
            name: 'Current',
            kind: 'audio',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-current-freeze' },
            clips: [
                {
                    id: 'clip-current',
                    trackId: 'track-current',
                    name: 'current take',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    audioBufferId: 'buf-current-clip',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                },
            ],
            alternatives: [
                {
                    id: 'alt-current',
                    name: 'Current Alt',
                    clips: [
                        {
                            id: 'clip-current-alt',
                            trackId: 'track-current',
                            name: 'current alt',
                            startBeat: 4,
                            endBeat: 8,
                            type: 'audio',
                            audioBufferId: 'buf-current-alt',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                        },
                    ],
                },
            ],
        });
        const arrangement_track = normalizeTrack({
            id: 'track-arrangement',
            name: 'Arrangement',
            kind: 'audio',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-arrangement-freeze' },
            clips: [
                {
                    id: 'clip-arrangement',
                    trackId: 'track-arrangement',
                    name: 'arrangement take',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    audioBufferId: 'buf-arrangement-clip',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                },
            ],
            alternatives: [
                {
                    id: 'alt-arrangement',
                    name: 'Arrangement Alt',
                    clips: [
                        {
                            id: 'clip-arrangement-alt',
                            trackId: 'track-arrangement',
                            name: 'arrangement alt',
                            startBeat: 4,
                            endBeat: 8,
                            type: 'audio',
                            audioBufferId: 'buf-arrangement-alt',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                        },
                    ],
                },
            ],
        });
        const cached_buffer = { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] };
        vi.mocked(exportCachedAudioBuffers).mockResolvedValue({
            'buf-current-clip': cached_buffer,
            'buf-arrangement-alt': cached_buffer,
        });
        trackStore.set({ tracks: [current_track], selectedTrackId: null });
        arrangementStore.set({
            arrangements: [
                {
                    id: 'arrangement-a',
                    name: 'Arrangement A',
                    tracks: { tracks: [arrangement_track], selectedTrackId: null },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
            activeArrangementId: 'arrangement-a',
        });

        await exportProjectFile();

        const expected_buffer_ids = [
            'buf-current-freeze',
            'buf-current-clip',
            'buf-current-alt',
            'buf-arrangement-freeze',
            'buf-arrangement-clip',
            'buf-arrangement-alt',
        ];
        const export_input = vi.mocked(exportCachedAudioBuffers).mock.calls[0]?.[0];
        expect(export_input?.bufferIds).toEqual(expect.arrayContaining(expected_buffer_ids));
        expect(export_input?.bufferIds).toHaveLength(expected_buffer_ids.length);
        expect(written().audioBuffers).toEqual({
            'buf-current-clip': cached_buffer,
            'buf-arrangement-alt': cached_buffer,
        });
        const saved_arrangement_clip = written().arrangements?.[0]?.tracks?.tracks[0]?.clips[0];
        expect(saved_arrangement_clip).toMatchObject({ bufferId: 'buf-arrangement-clip' });
        expect(saved_arrangement_clip).not.toHaveProperty('audioBufferId');
        expect(notifyUser).toHaveBeenCalledWith(
            '4 audio files could not be bundled with the export — the project may not play back correctly on another machine.',
            'warning'
        );
    });

    it('blocks save and export snapshots after malformed raw adjustment layers enter CRDT repair', async () => {
        const createdAt = 1_700_000_000_000;
        const recentKey = `${NAMED_PROJECT_KEY_PREFIX}${createdAt}`;
        const indexedDb = installFakeIndexedDb();
        seedSavableProject(createdAt);
        configurePassingProjectInspection();
        replaceRootWithMalformedAdjustmentLayers();

        projectCrdtToStores();

        expect(agentProjectRepairStateStore.value).toMatchObject({
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'repair-project-invariants',
                    targetIds: ['@project/raw/adjustmentLayers'],
                },
            ],
            status: 'repair-required',
        });
        await expect(buildProjectData({ includeAudioBuffers: false })).resolves.toBeNull();

        await exportProjectFile();

        expect(downloadProjectFile).not.toHaveBeenCalled();

        await expect(saveProject()).resolves.toBe(false);

        expect(persistCrdtProjectMock).not.toHaveBeenCalled();
        expect(indexedDb.values.has(recentKey)).toBe(false);
    });
});
