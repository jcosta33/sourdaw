import { decodeChange, getAllChanges } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { createSession, leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, pushUndoEntry, undo } from '#/modules/Command/useCases';
import { DOC_PREFIX_ROOT, getCrdtDoc, mutateCrdtDoc, resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { setFermenterDependencies, setFermenterMappedParam } from '#/modules/Fermenter/useCases';
import { sidechainStore } from '#/modules/Routing/stores';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { getProjectHandlers } from '../../../getProjectHandlers';
import { buildProjectData } from '../../../projectPersistence/fileIO/buildProjectData';
import { hydrateArrangementStoreFromProjectData } from '../../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../../../projectPersistence/helpers/resetModuleStoresToDefault';
import { stopActiveAutoSave } from '../../../projectPersistence/helpers/stopActiveAutoSave';
import { setProjectIdentityTransitionDependencies } from '../../../projectPersistence/projectIdentityTransitionDependencies';
import { createPopSongTemplate } from '../../templateFiles/popSong';
import { createFromTemplate } from '../createFromTemplate';

const mocks = vi.hoisted(() => ({
    compactProject: vi.fn(() => Promise.resolve()),
    ensureTrackStrips: vi.fn(),
    leaveCollaborationSession: vi.fn(() => Promise.resolve()),
    resetAudioGraph: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    stopPlayback: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return { ...actual, resetAudioGraph: mocks.resetAudioGraph };
});

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...actual,
        compactProject: mocks.compactProject,
        startCrdtAutoSave: mocks.startCrdtAutoSave,
    };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        ensureTrackStrips: mocks.ensureTrackStrips,
        stopPlayback: mocks.stopPlayback,
    };
});

const SECTION_NAMES = [
    'Sporefall',
    'First Germination',
    'Pressure Bloom',
    'Drop I — Hyphal Drive',
    'Psilocybin Chapel',
    'Singularity Build',
    'Drop II — Fractal Bloom',
    'Dissolution',
] as const;

const DISCONNECTED_COLLABORATION_STATE = {
    isEnabled: false,
    sessionId: null,
    localPeerId: null,
    localName: '',
    localColor: '',
    isHost: false,
    peers: [],
    connectionStatus: 'disconnected',
    error: null,
} as const;

type SerializedProjectData = NonNullable<Awaited<ReturnType<typeof buildProjectData>>>['data'];

async function readSerializedProject(): Promise<SerializedProjectData> {
    const built = await buildProjectData({ includeAudioBuffers: false });
    if (!built) {
        throw new Error('Expected a serializable project');
    }
    return built.data;
}

function normalizeVolatileProjectIdentity(data: SerializedProjectData): SerializedProjectData {
    const normalized = structuredClone(data);
    normalized.meta.createdAt = 0;
    normalized.meta.updatedAt = 0;
    return normalized;
}

function resetProjectFixture(name: string): void {
    stopActiveAutoSave();
    clearUndoHistory();
    resetModuleStoresToDefault();
    projectStore.set(defaultProjectStoreState);
    resetCrdtProjectAuthority(name);
    flushAutomergeStorageWrites();
}

describe('Mycelium Ascendant template replacement', () => {
    beforeEach(async () => {
        await leaveSession();
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        resetModuleStoresToDefault();
        projectStore.set(defaultProjectStoreState);
        mocks.leaveCollaborationSession.mockImplementation(() => leaveSession());
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: mocks.leaveCollaborationSession,
        });
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks: () => [],
            resolveEligibleDeviceWriteTarget: (deviceId) => ({
                status: 'eligible',
                trackId: 'stale-fermenter-track',
                deviceId,
            }),
            updateDeviceParam: () => undefined,
            persistDeviceParam: () => undefined,
        });
        registerHandlerMap(getProjectHandlers());
    });

    afterEach(async () => {
        stopActiveAutoSave();
        await leaveSession();
        clearHandlerRegistry();
        clearUndoHistory();
        resetModuleStoresToDefault();
        flushAutomergeStorageWrites();
        projectStore.set(defaultProjectStoreState);
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () =>
                Promise.reject(new Error('Project identity transition dependencies are not configured')),
        });
    });

    it('replaces prior state with Mycelium Ascendant', async () => {
        await expect(createFromTemplate('demo-mycelium-ascendant')).resolves.toBe(true);
        const canonicalProject = await readSerializedProject();

        resetProjectFixture('Unrelated Fixture');
        await createPopSongTemplate();
        const fixtureData = await readSerializedProject();
        delete fixtureData.arrangements;
        delete fixtureData.activeArrangementId;
        fixtureData.automation = {
            lanes: [
                {
                    id: 'stale-automation-lane',
                    trackId: fixtureData.arrangement.tracks[0]!.id,
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
                        { beat: 4, value: 0.75, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };
        fixtureData.midi = {
            notesByClipId: {
                'stale-midi-clip': [
                    {
                        id: 'stale-midi-note',
                        pitch: 61,
                        startBeat: 0,
                        duration: 1,
                        velocity: 73,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
            probabilitySeed: 1,
        };
        fixtureData.tempoMap = {
            changes: [{ id: 'stale-tempo-change', beat: 0, tempo: 91, curve: 'instant' }],
        };
        fixtureData.timeSignatureMap = {
            changes: [{ id: 'stale-meter-change', beat: 0, numerator: 3, denominator: 4 }],
        };
        fixtureData.takeLanes = {
            lanes: [
                {
                    id: 'stale-take-lane',
                    trackId: fixtureData.arrangement.tracks[0]!.id,
                    takes: [
                        {
                            id: 'stale-take',
                            clipId: 'stale-midi-clip',
                            name: 'Stale take',
                            startBeat: 0,
                            endBeat: 4,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'stale-take' }],
                },
            ],
        };
        fixtureData.yeast = {
            processors: [{ id: 'stale-yeast-processor', type: 'groove', name: 'Stale Groove', bypassed: false }],
        };
        hydrateArrangementStoreFromProjectData({ data: fixtureData });
        hydrateModuleStoresFromProjectData(fixtureData);
        flushAutomergeStorageWrites();
        const retainedUndoCallback = vi.fn();
        const staleRedoCallback = vi.fn();
        pushUndoEntry('Stale retained undo history', retainedUndoCallback, () => undefined);
        pushUndoEntry('Stale redo history', staleRedoCallback, () => undefined);
        await undo();
        expect(staleRedoCallback).toHaveBeenCalledOnce();
        mutateCrdtDoc<{ fixtureState?: string }>({
            id: DOC_PREFIX_ROOT,
            changeFn: (document) => {
                document.fixtureState = 'stale-crdt-history';
            },
            message: 'Seed unrelated project history',
        });
        const fixtureRootDocument = getCrdtDoc<{ fixtureState?: string }>(DOC_PREFIX_ROOT);
        if (!fixtureRootDocument) {
            throw new Error('Expected the fixture root CRDT document');
        }
        expect(getAllChanges(fixtureRootDocument).map((change) => decodeChange(change).message)).toContain(
            'Seed unrelated project history'
        );
        setFermenterMappedParam({
            deviceId: 'stale-fermenter-device',
            paramId: 'filterCutoff',
            value: 777,
        });

        const populatedProject = await readSerializedProject();
        const previousTrackIds = new Set(populatedProject.arrangement.tracks.map((track) => track.id));
        const previousDeviceIds = new Set(
            populatedProject.arrangement.tracks.flatMap((track) => track.devices.map((device) => device.id))
        );
        expect(projectStore.value?.name).toBe('Pop Song');
        expect(populatedProject.midi.notesByClipId['stale-midi-clip']).toHaveLength(1);
        expect(populatedProject.automation.lanes.map((lane) => lane.id)).toContain('stale-automation-lane');
        expect(populatedProject.tempoMap?.changes[0]?.id).toBe('stale-tempo-change');
        expect(populatedProject.timeSignatureMap?.changes[0]?.id).toBe('stale-meter-change');
        expect(populatedProject.takeLanes?.lanes[0]?.id).toBe('stale-take-lane');
        expect(populatedProject.sidechainRoutes?.length).toBeGreaterThan(0);
        expect(populatedProject.yeast?.processors[0]?.id).toBe('stale-yeast-processor');
        expect(previousDeviceIds.size).toBeGreaterThan(0);
        expect(undoStore.value?.past.map((entry) => entry.label)).toContain('Stale retained undo history');
        expect(undoStore.value?.future.map((entry) => entry.label)).toContain('Stale redo history');
        expect(getCrdtDoc<{ fixtureState?: string }>(DOC_PREFIX_ROOT)?.fixtureState).toBe('stale-crdt-history');
        expect(fermenterStore.value?.['stale-fermenter-device']?.patch.filterCutoff).toBe(777);
        const fixtureSessionId = createSession('Fixture Collaborator');
        expect(collaborationStore.value).toMatchObject({
            isEnabled: true,
            sessionId: fixtureSessionId,
            localName: 'Fixture Collaborator',
            isHost: true,
        });
        expect(collaborationStore.value?.localPeerId).not.toBeNull();

        vi.clearAllMocks();
        await expect(createFromTemplate('demo-mycelium-ascendant')).resolves.toBe(true);

        const replacedProject = await readSerializedProject();
        const tracks = trackStore.value?.tracks ?? [];
        expect(normalizeVolatileProjectIdentity(replacedProject)).toEqual(
            normalizeVolatileProjectIdentity(canonicalProject)
        );
        expect(JSON.stringify(replacedProject)).not.toContain('stale-');
        expect(projectStore.value).toMatchObject({
            name: 'Mycelium Ascendant',
            loading: false,
            initialized: true,
        });
        expect(tracks).toHaveLength(43);
        expect(tracks.every((track) => !previousTrackIds.has(track.id))).toBe(true);
        expect(tracks.flatMap((track) => track.devices).every((device) => !previousDeviceIds.has(device.id))).toBe(
            true
        );
        expect(automationStore.value?.lanes).toHaveLength(115);
        expect(replacedProject.midi.probabilitySeed).toBe(canonicalProject.midi.probabilitySeed);
        expect(replacedProject.midi.probabilitySeed).not.toBe(1);
        expect(sidechainStore.value?.routes).toHaveLength(1);
        expect(markerStore.value?.sections.map((section) => section.name)).toEqual(SECTION_NAMES);
        expect(undoStore.value).toEqual({ past: [], future: [] });
        const replacedRootDocument = getCrdtDoc<{ fixtureState?: string }>(DOC_PREFIX_ROOT);
        if (!replacedRootDocument) {
            throw new Error('Expected the replacement root CRDT document');
        }
        expect(replacedRootDocument.fixtureState).toBeUndefined();
        expect(getAllChanges(replacedRootDocument).map((change) => decodeChange(change).message)).not.toContain(
            'Seed unrelated project history'
        );
        expect(fermenterStore.value?.['stale-fermenter-device']).toBeUndefined();
        expect(collaborationStore.value).toEqual(DISCONNECTED_COLLABORATION_STATE);
        expect(mocks.leaveCollaborationSession).toHaveBeenCalledOnce();
        expect(mocks.resetAudioGraph).toHaveBeenCalledOnce();
        expect(mocks.startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });

    it('handles repeated demo launch after the first generation writes', async () => {
        await expect(createFromTemplate('demo-mycelium-ascendant')).resolves.toBe(true);
        const canonicalProject = await readSerializedProject();
        resetProjectFixture('Repeated Launch Fixture');
        const raceSessionId = createSession('Race Fixture');
        expect(collaborationStore.value).toMatchObject({ isEnabled: true, sessionId: raceSessionId, isHost: true });
        vi.clearAllMocks();
        const successorLaunches: Promise<boolean>[] = [];
        const unsubscribe = trackStore.subscribe((state) => {
            if (
                successorLaunches.length === 0 &&
                state?.tracks.length === 43 &&
                projectStore.value?.name === 'Mycelium Ascendant'
            ) {
                successorLaunches.push(createFromTemplate('demo-mycelium-ascendant'));
            }
        });

        try {
            const firstResult = await createFromTemplate('demo-mycelium-ascendant');
            const successorLaunch = successorLaunches[0];
            if (!successorLaunch) {
                throw new Error('Expected the first generation write to launch its successor');
            }
            const secondResult = await successorLaunch;
            expect([firstResult, secondResult]).toEqual([false, true]);
        } finally {
            unsubscribe();
        }

        expect(projectStore.value).toMatchObject({
            name: 'Mycelium Ascendant',
            loading: false,
            initialized: true,
        });
        expect(trackStore.value?.tracks).toHaveLength(43);
        expect(new Set(trackStore.value?.tracks.map((track) => track.id))).toHaveProperty('size', 43);
        const racedProject = await readSerializedProject();
        expect(normalizeVolatileProjectIdentity(racedProject)).toEqual(
            normalizeVolatileProjectIdentity(canonicalProject)
        );
        expect(collaborationStore.value).toEqual(DISCONNECTED_COLLABORATION_STATE);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });
});
