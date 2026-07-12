import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { getRecentProjects } from '../../../recentProjects/helpers';
import { loadRecentProject } from '../../../recentProjects/loadRecentProject';
import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { saveProject } from '../saveProject';

import type { ProjectStoreState } from '../../../../stores/projectStore';

// save -> list -> load round-trip. saveProject is the producer the recent list
// depends on: it must write a flat-JSON ProjectData snapshot under the recent
// entry's key so loadRecentProject can reopen it. Real storageOperations
// (localStorage in jsdom), real addToRecentProjects/getRecentProjects, real
// loadRecentProject read path — only CRDT persist, the serializer, the audio
// side effects, and store hydration are stubbed.

const CREATED_AT = 1700000000000;
const PROJECT_NAME = 'Round Trip Song';
const RECENT_KEY = `sourdaw:project:${CREATED_AT}`;

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as ProjectStoreState | null },
    projectStoreSet: vi.fn<(value: ProjectStoreState) => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
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
    createCrdtProject: vi.fn().mockResolvedValue(true),
    persistCrdtProject: mocks.persistCrdtProject,
    projectActionHistoryToStore: vi.fn(),
}));

vi.mock('../../fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));

// loadRecentProject side effects — none touch the round-trip storage path.
vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(),
    restoreCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { restoreFromIdb: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: { value: null } }));
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
    };
}

function makeProjectData(): ProjectData {
    return {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            name: PROJECT_NAME,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: {} as ProjectData['transport'],
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
        window.localStorage.clear();
        mocks.projectStoreValue.value = makeProjectState();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.buildProjectData.mockResolvedValue({ data: makeProjectData(), missingBufferCount: 0 });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
    });

    it('a saved project appears in the recent list and reopens with its name', async () => {
        saveProject();

        // The recent entry only lands after CRDT persistence settles.
        await vi.waitFor(() => {
            expect(getRecentProjects()).toHaveLength(1);
        });

        const entry = getRecentProjects()[0];
        expect(entry.key).toBe(RECENT_KEY);

        // Clear the live project so a successful load is observable as a refill.
        mocks.projectStoreValue.value = null;

        const ok = await loadRecentProject(entry.key);

        expect(ok).toBe(true);
        expect(mocks.projectStoreValue.value).not.toBeNull();
        expect(mocks.projectStoreValue.value?.name).toBe(PROJECT_NAME);
    });
});
