import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../../__tests__/fakeIndexedDb';

import type { ProjectStoreState } from '../../../../stores/projectStore';

const RECENT_KEY = 'sourdaw:project:1700000000000';

// 60 s of 48 kHz stereo float32 = 23,040,000 bytes, which the serializer
// expands to 30,720,000 base64 characters. The exact figure is what makes the
// localStorage ceiling assertion meaningful rather than accidental.
const BASE64_CHARS_FOR_60S_STEREO = Math.ceil((60 * 48_000 * 2 * 4) / 3) * 4;

// localStorage may hold the recent-projects index and pointers only. A recent
// entry is roughly 100 bytes and the index is capped at ten of them, so 8 KiB
// is generous for bounded metadata and orders of magnitude below any project
// document.
const LOCAL_STORAGE_VALUE_CEILING_BYTES = 8 * 1024;

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as ProjectStoreState | null },
    projectStoreSet: vi.fn<(value: ProjectStoreState) => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    captureProjectRevision: vi.fn<() => string>(),
    addToRecentProjects: vi.fn<(name: string, key: string) => void>(),
    buildProjectData: vi.fn<(input?: { includeAudioBuffers?: boolean }) => Promise<{ data: unknown } | null>>(),
    captureExternalPluginStates: vi.fn<() => Promise<void>>(),
    loggerWarn: vi.fn<(...args: unknown[]) => void>(),
    notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
}));

vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('../../../recentProjects/addToRecentProjects', () => ({
    addToRecentProjects: mocks.addToRecentProjects,
}));

vi.mock('../../fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));

vi.mock('../captureExternalPluginStates', () => ({
    captureExternalPluginStates: mocks.captureExternalPluginStates,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

function makeProject(): ProjectStoreState {
    return {
        name: 'My Song',
        // A canonical identity is the steady-state precondition: every project
        // created or loaded by this build carries one. Without it,
        // migrateActiveProjectIdentity (the real one runs in this spec) mints
        // and persists an identity before serialization, so the
        // build → persist → capture ordering asserted below no longer holds.
        projectId: '11111111-2222-4333-8444-555555555555',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        dirty: true,
        loading: false,
    } as unknown as ProjectStoreState;
}

function makeProjectDataWithSixtySecondsOfStereoAudio(): { data: unknown } {
    return {
        data: {
            version: 1,
            meta: { name: 'My Song', createdAt: 1700000000000, updatedAt: 1700000000000 },
            audioBuffers: {
                'buffer-1': {
                    sampleRate: 48_000,
                    length: 60 * 48_000,
                    numberOfChannels: 2,
                    channels: ['A'.repeat(BASE64_CHARS_FOR_60S_STEREO)],
                },
            },
        },
    };
}

async function importSaveProject(): Promise<() => Promise<boolean>> {
    const module = await import('../saveProject');
    return module.saveProject;
}

describe('saveProject durability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        localStorage.clear();
        mocks.projectStoreValue.value = makeProject();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.captureProjectRevision.mockReturnValue('saved-revision');
        mocks.captureExternalPluginStates.mockResolvedValue(undefined);
        mocks.buildProjectData.mockResolvedValue({
            data: { version: 1, meta: { name: 'My Song', updatedAt: 1700000000000 } },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    // AC-1, scale evidence. Runs the real writeNamedProjectJsonByKey against a
    // fake IndexedDB with the payload size the AC names.
    //
    // Note on mutation: restoring the dual-write does NOT red this test, and
    // that is the defect rather than a gap. A 30 MB value blows the
    // localStorage quota, `setItem` throws, and the restored `catch` swallows
    // it — which is precisely how the mirror froze in production. The
    // mutation-reddable AC-1 guard for this path is the small-project save
    // below (and `writeNamedProjectJsonByKey.spec.ts`), where the write
    // succeeds and is therefore observable.
    it('writes no project content to localStorage when saving 60 seconds of stereo audio', async () => {
        const controls = installFakeIndexedDb();
        mocks.buildProjectData.mockResolvedValue(makeProjectDataWithSixtySecondsOfStereoAudio());
        const saveProject = await importSaveProject();

        await expect(saveProject()).resolves.toBe(true);

        // Pins the fixture: the snapshot really is oversized, so the ceiling
        // below cannot be satisfied by an accidentally tiny project.
        expect(controls.values.get(RECENT_KEY)?.length ?? 0).toBeGreaterThan(30_000_000);

        expect(localStorage.getItem(RECENT_KEY)).toBeNull();
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key === null) {
                continue;
            }
            const value = localStorage.getItem(key) ?? '';
            expect(value.length).toBeLessThanOrEqual(LOCAL_STORAGE_VALUE_CEILING_BYTES);
        }
    });

    // AC-3. Mutation: reverting saveProject to call writeNamedProjectJsonByKey
    // without awaiting it reds `resolves.toBe(false)` and
    // `expect(addToRecentProjects).not.toHaveBeenCalled()`.
    it('reports failure and lists nothing when the snapshot transaction aborts', async () => {
        const controls = installFakeIndexedDb();
        controls.abortWrites();
        const saveProject = await importSaveProject();

        await expect(saveProject()).resolves.toBe(false);

        expect(controls.values.has(RECENT_KEY)).toBe(false);
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Save failed — your latest changes could not be persisted.',
            'error'
        );
    });

    // AC-3. The listed-project-points-at-nothing case: buildProjectData returns
    // null, so no snapshot exists under the recent key, yet the entry was still
    // recorded. Mutation: making the addToRecentProjects call unconditional
    // again reds `expect(addToRecentProjects).not.toHaveBeenCalled()`.
    it('reports failure and lists nothing when no snapshot could be built', async () => {
        installFakeIndexedDb();
        mocks.buildProjectData.mockResolvedValue(null);
        const saveProject = await importSaveProject();

        await expect(saveProject()).resolves.toBe(false);

        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
        expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('keeps the project dirty when project truth changes while the snapshot is being written', async () => {
        installFakeIndexedDb();
        mocks.captureProjectRevision.mockReturnValueOnce('saved-revision').mockReturnValueOnce('newer-revision');
        const saveProject = await importSaveProject();

        await expect(saveProject()).resolves.toBe(true);

        expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('captures and persists the revision produced by project serialization', async () => {
        installFakeIndexedDb();
        const saveProject = await importSaveProject();

        await expect(saveProject()).resolves.toBe(true);

        // Identity migration may persist once before the save-local snapshot is
        // built. Trace the latest call pair owned by this save, not global first
        // invocation order across migration and snapshot persistence.
        const buildOrder = mocks.buildProjectData.mock.invocationCallOrder.at(-1);
        const captureOrder = mocks.captureProjectRevision.mock.invocationCallOrder.at(-1);
        const persistOrder = mocks.persistCrdtProject.mock.invocationCallOrder.at(-1);
        // build → persist → capture: the revision baseline is captured AFTER
        // persist settles so the save's own CRDT bookkeeping (the persist
        // commit's mutationEpoch/heads advance) is in the baseline, not in the
        // post-save guard's delta. Capturing before persist compared the guard
        // against a baseline the save itself invalidated, so dirty could never
        // clear.
        expect(buildOrder ?? 0).toBeLessThan(persistOrder ?? 0);
        expect(persistOrder ?? 0).toBeLessThan(captureOrder ?? 0);
    });

    // AC-5. The live save snapshot references audio by id; the PCM itself lives
    // in the runtime audio cache's IndexedDB store as raw Float32Array. The
    // stand-in below embeds base64 PCM whenever the caller lets it, so the
    // persisted bytes prove which shape `saveProject` asked for.
    //
    // Mutation: reverting saveProject to `buildProjectData()` (no argument) reds
    // both `toHaveBeenCalledWith({ includeAudioBuffers: false })` and the exact
    // persisted-snapshot equality — the stand-in then embeds 30 MB of base64.
    it('persists a save snapshot that carries no embedded audio payload', async () => {
        const controls = installFakeIndexedDb();
        const snapshotWithoutAudio = { version: 1, meta: { name: 'My Song', updatedAt: 1700000000000 } };
        function embedAudio(data: Record<string, unknown>): Record<string, unknown> {
            return {
                ...data,
                audioBuffers: {
                    'buffer-1': {
                        sampleRate: 48_000,
                        numberOfChannels: 2,
                        channelData: ['A'.repeat(BASE64_CHARS_FOR_60S_STEREO / 2)],
                    },
                },
            };
        }
        mocks.buildProjectData.mockImplementation((input) =>
            Promise.resolve({
                data: input?.includeAudioBuffers === false ? snapshotWithoutAudio : embedAudio(snapshotWithoutAudio),
            })
        );

        // Fixture pin: the stand-in really is capable of embedding base64 PCM,
        // so the assertions below cannot be satisfied by an inert fixture.
        await expect(mocks.buildProjectData({ includeAudioBuffers: true })).resolves.toHaveProperty(
            'data.audioBuffers',
            expect.any(Object)
        );
        mocks.buildProjectData.mockClear();

        const saveProject = await importSaveProject();
        await expect(saveProject()).resolves.toBe(true);

        expect(mocks.buildProjectData).toHaveBeenCalledWith({ includeAudioBuffers: false });
        expect(controls.values.get(RECENT_KEY)).toBe(JSON.stringify(snapshotWithoutAudio));
    });

    // AC-1 + AC-3. A project small enough for the localStorage write to succeed
    // is the case where the dual-write is observable at all.
    // Mutation: restoring `window.localStorage.setItem(key, json)` in
    // writeNamedProjectJsonByKey reds `expect(localStorage.length).toBe(0)`.
    it('records the recent entry pointing at a snapshot that exists, and mirrors nothing', async () => {
        const controls = installFakeIndexedDb();
        const saveProject = await importSaveProject();

        await expect(saveProject()).resolves.toBe(true);

        expect(mocks.addToRecentProjects).toHaveBeenCalledWith('My Song', RECENT_KEY);
        expect(controls.values.get(RECENT_KEY)).toBe(
            JSON.stringify({ version: 1, meta: { name: 'My Song', updatedAt: 1700000000000 } })
        );
        expect(localStorage.length).toBe(0);
    });
});
