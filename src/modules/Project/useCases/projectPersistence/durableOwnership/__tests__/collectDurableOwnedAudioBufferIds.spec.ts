import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { getProjectSnapshotKey } from '../../getProjectSnapshotKey';

// Imported fresh per test. `storageSupport` memoizes its IndexedDB connection
// and the recent-projects adapter caches its entries for the life of the
// module, and these tests install a new IndexedDB factory per test.
type SubjectModules = {
    collectDurableOwnedAudioBufferIds: typeof import('../collectDurableOwnedAudioBufferIds').collectDurableOwnedAudioBufferIds;
    storageSupport: typeof import('../../../../repositories/project/storageSupport').storageSupport;
    writeNamedProjectJsonByKey: typeof import('../../../../repositories/project/writeNamedProjectJsonByKey').writeNamedProjectJsonByKey;
    readNamedProjectJson: typeof import('../../../../repositories/project/readNamedProjectJson').readNamedProjectJson;
    addToRecentProjects: typeof import('../../../recentProjects/addToRecentProjects').addToRecentProjects;
    getRecentProjects: typeof import('../../../recentProjects/helpers').getRecentProjects;
    removeFromRecentProjects: typeof import('../../../recentProjects/removeFromRecentProjects').removeFromRecentProjects;
};

async function importSubjectModules(): Promise<SubjectModules> {
    const [subject, storage, writeNamed, readNamed, addToRecent, recentHelpers, removeFromRecent] = await Promise.all([
        import('../collectDurableOwnedAudioBufferIds'),
        import('../../../../repositories/project/storageSupport'),
        import('../../../../repositories/project/writeNamedProjectJsonByKey'),
        import('../../../../repositories/project/readNamedProjectJson'),
        import('../../../recentProjects/addToRecentProjects'),
        import('../../../recentProjects/helpers'),
        import('../../../recentProjects/removeFromRecentProjects'),
    ]);
    return {
        collectDurableOwnedAudioBufferIds: subject.collectDurableOwnedAudioBufferIds,
        storageSupport: storage.storageSupport,
        writeNamedProjectJsonByKey: writeNamed.writeNamedProjectJsonByKey,
        readNamedProjectJson: readNamed.readNamedProjectJson,
        addToRecentProjects: addToRecent.addToRecentProjects,
        getRecentProjects: recentHelpers.getRecentProjects,
        removeFromRecentProjects: removeFromRecent.removeFromRecentProjects,
    };
}

// The enumeration must speak for actually-persisted projects, so every test
// here writes its snapshot through the real repository path saveProject uses
// (`writeNamedProjectJsonByKey` into real fake-indexeddb transactions) and
// reads nothing from in-memory state.

const PROJECT_A_CREATED_AT = 1_700_000_000_000;
const PROJECT_B_CREATED_AT = 1_700_000_100_000;

function clip(bufferId: string): ProjectData['arrangement']['tracks'][number]['clips'][number] {
    return {
        id: `clip-${bufferId}`,
        trackId: 'track-1',
        name: bufferId,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000000',
        locked: false,
        muted: false,
        bufferId,
    };
}

function projectDataFixture({
    clips,
    frozenBufferId,
    alternativeClips = [],
    storedArrangementClips = [],
}: {
    clips: ReturnType<typeof clip>[];
    frozenBufferId?: string;
    alternativeClips?: ReturnType<typeof clip>[];
    storedArrangementClips?: ReturnType<typeof clip>[];
}): ProjectData {
    return {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            name: 'Owned Song',
            createdAt: PROJECT_A_CREATED_AT,
            updatedAt: PROJECT_A_CREATED_AT,
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
        arrangement: {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Audio',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    color: '#000000',
                    clips,
                    devices: [],
                    sends: [],
                    midiFx: [],
                    frozen: frozenBufferId !== undefined,
                    ...(frozenBufferId !== undefined ? { frozenBufferId } : {}),
                    freezeState: {
                        status: frozenBufferId !== undefined ? 'frozen' : 'unfrozen',
                        ...(frozenBufferId !== undefined ? { frozenBufferId } : {}),
                    },
                    parentId: null,
                    collapsed: false,
                    inputMonitoring: 'auto',
                    hidden: false,
                    disabled: false,
                    height: 64,
                    outputId: 'master',
                    automationMode: 'read',
                    groupId: null,
                    soloSafe: false,
                    notes: '',
                    inputId: null,
                    activeAlternativeId: 'alt-1',
                    alternatives: [
                        {
                            id: 'alt-1',
                            name: 'Take 1',
                            clips: alternativeClips,
                        },
                    ],
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    followChordTrack: false,
                },
            ],
        },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers: [],
        ...(storedArrangementClips.length > 0
            ? {
                  arrangements: [
                      {
                          id: 'arrangement-2',
                          name: 'Second',
                          tracks: {
                              tracks: [
                                  {
                                      id: 'track-inactive',
                                      name: 'Audio',
                                      kind: 'audio' as const,
                                      muted: false,
                                      soloed: false,
                                      armed: false,
                                      gain: 1,
                                      pan: 0,
                                      color: '#000000',
                                      clips: storedArrangementClips,
                                      devices: [],
                                      sends: [],
                                      midiFx: [],
                                      frozen: false,
                                      freezeState: { status: 'unfrozen' as const },
                                      parentId: null,
                                      collapsed: false,
                                      inputMonitoring: 'auto' as const,
                                      hidden: false,
                                      disabled: false,
                                      height: 64,
                                      outputId: 'master',
                                      automationMode: 'read' as const,
                                      groupId: null,
                                      soloSafe: false,
                                      notes: '',
                                      inputId: null,
                                      activeAlternativeId: 'alt-1',
                                      alternatives: [],
                                      vcaGroupId: null,
                                      midiOutputTrackId: null,
                                      followChordTrack: false,
                                  },
                              ],
                              selectedTrackId: null,
                          },
                      },
                  ],
                  activeArrangementId: 'arrangement-2',
              }
            : {}),
        history: { checkpoints: [] },
    };
}

let modules: SubjectModules;
let installation: TransactionalIndexedDbInstallation;

function projectSnapshotForPersistence(name: string, createdAt: number, data: ProjectData): ProjectData {
    return {
        ...data,
        meta: {
            ...data.meta,
            projectId: crypto.randomUUID(),
            name,
            createdAt,
            updatedAt: createdAt,
        },
    };
}

async function persistSavedProject(name: string, createdAt: number, data: ProjectData): Promise<string> {
    const key = getProjectSnapshotKey(createdAt);
    await modules.writeNamedProjectJsonByKey(key, JSON.stringify(projectSnapshotForPersistence(name, createdAt, data)));
    modules.addToRecentProjects(name, key);
    return key;
}

describe('collectDurableOwnedAudioBufferIds', () => {
    beforeEach(async () => {
        vi.resetModules();
        window.localStorage.clear();
        installation = installTransactionalIndexedDb();
        modules = await importSubjectModules();
    });

    afterEach(async () => {
        await installation.dispose();
        window.localStorage.clear();
        vi.resetModules();
    });

    it('returns an empty set when no project is persisted', async () => {
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([]);
    });

    it('does not treat the active project cache record as a named project', async () => {
        await modules.storageSupport.putIndexedDb(modules.storageSupport.primaryKey, '{not-json');

        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([]);
    });

    it('derives buffer ids from the persisted snapshots of every saved project, inactive ones included', async () => {
        await persistSavedProject('Saved A', PROJECT_A_CREATED_AT, projectDataFixture({ clips: [clip('buffer-a')] }));
        await persistSavedProject('Saved B', PROJECT_B_CREATED_AT, projectDataFixture({ clips: [clip('buffer-b')] }));

        const owned = await modules.collectDurableOwnedAudioBufferIds();
        expect([...owned].sort()).toEqual(['buffer-a', 'buffer-b']);
    });

    it('keeps an evicted recent-project snapshot as a durable audio owner', async () => {
        const oldestKey = getProjectSnapshotKey(PROJECT_A_CREATED_AT);
        const oldestSnapshot = JSON.stringify(
            projectSnapshotForPersistence(
                'Saved 0',
                PROJECT_A_CREATED_AT,
                projectDataFixture({ clips: [clip('buffer-oldest')] })
            )
        );
        await modules.writeNamedProjectJsonByKey(oldestKey, oldestSnapshot);
        modules.addToRecentProjects('Saved 0', oldestKey);

        for (let index = 1; index <= 10; index++) {
            const createdAt = PROJECT_A_CREATED_AT + index;
            await persistSavedProject(
                `Saved ${index}`,
                createdAt,
                projectDataFixture({ clips: [clip(`buffer-${index}`)] })
            );
        }

        expect(modules.getRecentProjects()).toHaveLength(10);
        expect(modules.getRecentProjects()).not.toContainEqual(expect.objectContaining({ key: oldestKey }));
        await expect(modules.readNamedProjectJson(oldestKey)).resolves.toBe(oldestSnapshot);

        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toContain('buffer-oldest');
    });

    it('collects every current serialized reference section written by buildProjectData', async () => {
        await persistSavedProject(
            'Saved A',
            PROJECT_A_CREATED_AT,
            projectDataFixture({
                clips: [clip('buffer-active')],
                frozenBufferId: 'buffer-frozen',
                alternativeClips: [clip('buffer-alternative')],
                storedArrangementClips: [clip('buffer-inactive-arrangement')],
            })
        );

        const owned = await modules.collectDurableOwnedAudioBufferIds();
        expect([...owned].sort()).toEqual([
            'buffer-active',
            'buffer-alternative',
            'buffer-frozen',
            'buffer-inactive-arrangement',
        ]);
    });

    it('keeps a shared buffer owned after every recent-project entry is removed without deleting durable records', async () => {
        const keyA = await persistSavedProject(
            'Saved A',
            PROJECT_A_CREATED_AT,
            projectDataFixture({ clips: [clip('buffer-shared')] })
        );
        const keyB = await persistSavedProject(
            'Saved B',
            PROJECT_B_CREATED_AT,
            projectDataFixture({ clips: [clip('buffer-shared')] })
        );
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual(['buffer-shared']);

        modules.removeFromRecentProjects(keyA);
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual(['buffer-shared']);

        modules.removeFromRecentProjects(keyB);
        await expect(modules.readNamedProjectJson(keyA)).resolves.not.toBeNull();
        await expect(modules.readNamedProjectJson(keyB)).resolves.not.toBeNull();
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual(['buffer-shared']);
    });

    it('releases a project audio when its durable record is removed while the recent entry stays', async () => {
        const keyA = await persistSavedProject(
            'Saved A',
            PROJECT_A_CREATED_AT,
            projectDataFixture({ clips: [clip('buffer-a')] })
        );
        expect(modules.getRecentProjects()).toHaveLength(1);

        await modules.storageSupport.deleteIndexedDb(keyA);

        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([]);
    });

    it('skips a recents entry whose snapshot is absent', async () => {
        modules.addToRecentProjects('Never Saved', getProjectSnapshotKey(PROJECT_A_CREATED_AT));

        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([]);
    });

    it('rejects a legacy snapshot instead of treating it as current ownership data', async () => {
        const key = getProjectSnapshotKey(PROJECT_A_CREATED_AT);
        await modules.writeNamedProjectJsonByKey(
            key,
            JSON.stringify({
                version: 1,
                name: 'Legacy Song',
                createdAt: PROJECT_A_CREATED_AT,
                updatedAt: PROJECT_A_CREATED_AT,
                transport: { tempo: 120 },
                tracks: {
                    tracks: [
                        {
                            id: 'track-1',
                            name: 'Audio',
                            clips: [
                                { id: 'clip-1', bufferId: 'buffer-v1' },
                                { id: 'clip-2', audioBufferId: 'buffer-v1-legacy' },
                            ],
                            freezeState: { status: 'frozen', frozenBufferId: 'buffer-v1-frozen' },
                        },
                    ],
                },
            })
        );
        modules.addToRecentProjects('Legacy Song', key);

        await expect(modules.collectDurableOwnedAudioBufferIds()).rejects.toThrow(
            'is not a valid current-format project snapshot'
        );
    });

    it('fails the enumeration when a persisted snapshot cannot be parsed, so the collector can delete nothing', async () => {
        await persistSavedProject(
            'Valid owner',
            PROJECT_A_CREATED_AT,
            projectDataFixture({ clips: [clip('buffer-valid-owner')] })
        );
        const key = getProjectSnapshotKey(PROJECT_A_CREATED_AT + 1);
        await modules.writeNamedProjectJsonByKey(key, '{"arrangement":');
        modules.addToRecentProjects('Corrupt', key);

        await expect(modules.collectDurableOwnedAudioBufferIds()).rejects.toThrow();
    });

    it('fails the enumeration when a current-format snapshot has malformed tracks', async () => {
        const key = getProjectSnapshotKey(PROJECT_A_CREATED_AT);
        await modules.writeNamedProjectJsonByKey(key, JSON.stringify({ version: CURRENT_PROJECT_VERSION, meta: {} }));
        modules.addToRecentProjects('Uninterpretable', key);

        await expect(modules.collectDurableOwnedAudioBufferIds()).rejects.toThrow(
            'is not a valid current-format project snapshot'
        );
    });
});
