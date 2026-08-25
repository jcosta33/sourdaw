import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../../__tests__/fakeIndexedDb';
import { createDefaultProductionBrief } from '../../../../models/ProductionBrief';
import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { getRecentProjects } from '../../../recentProjects/helpers';
import { loadRecentProject } from '../../../recentProjects/loadRecentProject';
import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { saveProject } from '../saveProject';

import type { ProjectStoreState } from '../../../../stores/projectStore';

// save -> list -> load round-trip. saveProject is the producer the recent list
// depends on: it must write a flat-JSON ProjectData snapshot under the recent
// entry's key so loadRecentProject can reopen it. Real project storage (the
// IndexedDB double — since ADR 0013 the snapshot lives only there), real
// addToRecentProjects/getRecentProjects, real loadRecentProject read path —
// only CRDT persist, the serializer, the audio side effects, and store
// hydration are stubbed.

const CREATED_AT = 1700000000000;
const PROJECT_NAME = 'Round Trip Song';
const RECENT_KEY = `sourdaw:project:${CREATED_AT}`;

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as ProjectStoreState | null },
    projectStoreSet: vi.fn<(value: ProjectStoreState) => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    captureProjectRevision: vi.fn<() => string>(),
    buildProjectData: vi.fn(),
}));

vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: (value: ProjectStoreState) => {
            mocks.projectStoreValue.value = value;
            mocks.projectStoreSet(value);
        },
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    compactProject: vi.fn().mockResolvedValue(undefined),
    persistCrdtProject: mocks.persistCrdtProject,
    projectActionHistoryToStore: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
}));
vi.mock('../../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: vi.fn() }));
vi.mock('../../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: vi.fn() }));

vi.mock('../../fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));

// loadRecentProject side effects — none touch the round-trip storage path.
vi.mock('#/modules/Transport/useCases', () => ({
    defaultTransportState: { masterGain: 75, isPlaying: false },
    stopPlayback: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(),
    importCachedAudioBuffers: vi.fn().mockResolvedValue({ persist: () => Promise.resolve(true), publish: () => 0 }),
    prepareCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue({ cancel: () => undefined, publish: () => 0 }),
    restoreCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    clearUndoHistory: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { restoreFromIdb: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../helpers/hydrateArrangementStoreFromProjectData', () => ({
    hydrateArrangementStoreFromProjectData: vi.fn(),
}));
vi.mock('../../helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
}));
vi.mock('../../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));
vi.mock('../../helpers/verifyAudioBufferReferences', () => ({
    verifyAudioBufferReferences: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function makeProjectState(): ProjectStoreState {
    return {
        name: PROJECT_NAME,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        keyRoot: 0,
        scaleName: 'major',
        tuning: { name: '12-TET', frequencies: [] },
        dirty: true,
        loading: false,
        initialized: true,
        productionBrief: createDefaultProductionBrief(CREATED_AT),
    };
}

// Clearing through a helper keeps the test body free of a literal-null
// assignment that would otherwise narrow the store value to `null`.
function clearLiveProject(): void {
    mocks.projectStoreValue.value = null;
}

function makeProjectData(): ProjectData {
    return {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            // Required by isHydratableProjectData; this fixture predates
            // that hardening.
            projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            name: PROJECT_NAME,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: {
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 4,
            isLooping: false,
            metronomeEnabled: false,
            metronomeVolume: 0.8,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 4,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 0,
            masterGain: 1,
        },
        arrangement: { tracks: [] },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers: [],
        history: { checkpoints: [] },
    };
}

describe('saveProject -> recent list -> loadRecentProject round-trip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installFakeIndexedDb();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        window.localStorage.clear();
        mocks.projectStoreValue.value = makeProjectState();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.captureProjectRevision.mockReturnValue('saved-revision');
        mocks.buildProjectData.mockResolvedValue({ data: makeProjectData(), missingBufferCount: 0 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('a saved project appears in the recent list and reopens with its name', async () => {
        void saveProject();

        // The recent entry only lands after CRDT persistence settles.
        await vi.waitFor(() => {
            expect(getRecentProjects()).toHaveLength(1);
        });

        const entry = getRecentProjects()[0];
        if (!entry) {
            throw new Error('expected a recent project entry');
        }
        expect(entry.key).toBe(RECENT_KEY);

        // Clear the live project so a successful load is observable as a refill.
        clearLiveProject();

        const ok = await loadRecentProject(entry.key);

        expect(ok).toBe('committed');
        expect(mocks.projectStoreValue.value).not.toBeNull();
        expect(mocks.projectStoreValue.value?.name).toBe(PROJECT_NAME);
    });
});
