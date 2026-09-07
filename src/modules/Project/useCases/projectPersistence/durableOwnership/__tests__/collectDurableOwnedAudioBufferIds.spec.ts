import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../../__tests__/fakeIndexedDb';
import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { getProjectSnapshotKey } from '../../getProjectSnapshotKey';

// Imported fresh per test. `storageSupport` memoizes its IndexedDB connection
// and the recent-projects adapter caches its entries for the life of the
// module, and these tests install a new `indexedDB` double per test — without
// the reset, every test after the first would keep talking to the first test's
// double through the memoized connection.
type SubjectModules = {
    collectDurableOwnedAudioBufferIds: typeof import('../collectDurableOwnedAudioBufferIds').collectDurableOwnedAudioBufferIds;
    storageSupport: typeof import('../../../../repositories/project/storageSupport').storageSupport;
    writeNamedProjectJsonByKey: typeof import('../../../../repositories/project/writeNamedProjectJsonByKey').writeNamedProjectJsonByKey;
    addToRecentProjects: typeof import('../../../recentProjects/addToRecentProjects').addToRecentProjects;
    getRecentProjects: typeof import('../../../recentProjects/helpers').getRecentProjects;
    removeFromRecentProjects: typeof import('../../../recentProjects/removeFromRecentProjects').removeFromRecentProjects;
};

async function importSubjectModules(): Promise<SubjectModules> {
    const [subject, storage, writeNamed, addToRecent, recentHelpers, removeFromRecent] = await Promise.all([
        import('../collectDurableOwnedAudioBufferIds'),
        import('../../../../repositories/project/storageSupport'),
        import('../../../../repositories/project/writeNamedProjectJsonByKey'),
        import('../../../recentProjects/addToRecentProjects'),
        import('../../../recentProjects/helpers'),
        import('../../../recentProjects/removeFromRecentProjects'),
    ]);
    return {
        collectDurableOwnedAudioBufferIds: subject.collectDurableOwnedAudioBufferIds,
        storageSupport: storage.storageSupport,
        writeNamedProjectJsonByKey: writeNamed.writeNamedProjectJsonByKey,
        addToRecentProjects: addToRecent.addToRecentProjects,
        getRecentProjects: recentHelpers.getRecentProjects,
        removeFromRecentProjects: removeFromRecent.removeFromRecentProjects,
    };
}

// The enumeration must speak for actually-persisted projects, so every test
// here writes its snapshot through the real repository path saveProject uses
// (writeNamedProjectJsonByKey into the IndexedDB double, plus the real recent
// index entry) and reads nothing from in-memory state.

const PROJECT_A_CREATED_AT = 1_700_000_000_000;
const PROJECT_B_CREATED_AT = 1_700_000_100_000;

function clip(bufferId: string, legacy = false): ProjectData['arrangement']['tracks'][number]['clips'][number] {
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
        ...(legacy ? { audioBufferId: bufferId } : { bufferId }),
    };
}

function projectDataFixture({
    clips,
    frozenBufferId,
    alternativeClips = [],
    storedArrangementClips = [],
    audioBufferKeys = [],
}: {
    clips: ReturnType<typeof clip>[];
    frozenBufferId?: string;
    alternativeClips?: ReturnType<typeof clip>[];
    storedArrangementClips?: ReturnType<typeof clip>[];
    audioBufferKeys?: string[];
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
        ...(audioBufferKeys.length > 0
            ? {
                  audioBuffers: Object.fromEntries(
                      audioBufferKeys.map((id) => [id, { sampleRate: 48_000, numberOfChannels: 1, channelData: [] }])
                  ),
              }
            : {}),
        history: { checkpoints: [] },
    };
}

let modules: SubjectModules;

async function persistSavedProject(name: string, createdAt: number, data: ProjectData): Promise<string> {
    const key = getProjectSnapshotKey(createdAt);
    await modules.writeNamedProjectJsonByKey(key, JSON.stringify(data));
    modules.addToRecentProjects(name, key);
    return key;
}

describe('collectDurableOwnedAudioBufferIds', () => {
    beforeEach(async () => {
        vi.resetModules();
        installFakeIndexedDb();
        window.localStorage.clear();
        modules = await importSubjectModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns an empty set when no project is persisted', async () => {
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([]);
    });

    it('derives buffer ids from the persisted snapshots of every saved project, inactive ones included', async () => {
        await persistSavedProject('Saved A', PROJECT_A_CREATED_AT, projectDataFixture({ clips: [clip('buffer-a')] }));
        await persistSavedProject('Saved B', PROJECT_B_CREATED_AT, projectDataFixture({ clips: [clip('buffer-b')] }));

        const owned = await modules.collectDurableOwnedAudioBufferIds();
        expect([...owned].sort()).toEqual(['buffer-a', 'buffer-b']);
    });

    it('collects the sections buildProjectData writes ids into, with the legacy clip alias', async () => {
        await persistSavedProject(
            'Saved A',
            PROJECT_A_CREATED_AT,
            projectDataFixture({
                clips: [clip('buffer-active'), clip('buffer-legacy', true)],
                frozenBufferId: 'buffer-frozen',
                alternativeClips: [clip('buffer-alternative')],
                storedArrangementClips: [clip('buffer-inactive-arrangement')],
                audioBufferKeys: ['buffer-embedded'],
            })
        );

        const owned = await modules.collectDurableOwnedAudioBufferIds();
        expect([...owned].sort()).toEqual([
            'buffer-active',
            'buffer-alternative',
            'buffer-embedded',
            'buffer-frozen',
            'buffer-inactive-arrangement',
            'buffer-legacy',
        ]);
    });

    it('keeps a shared buffer owned while any referencing project remains, and releases it when none do', async () => {
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
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([]);
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

    it('fails the enumeration when a persisted snapshot cannot be parsed, so the collector can delete nothing', async () => {
        const key = getProjectSnapshotKey(PROJECT_A_CREATED_AT);
        await modules.writeNamedProjectJsonByKey(key, '{"arrangement":');
        modules.addToRecentProjects('Corrupt', key);

        await expect(modules.collectDurableOwnedAudioBufferIds()).rejects.toThrow();
    });

    it('fails the enumeration when a persisted snapshot has no arrangement tracks to read', async () => {
        const key = getProjectSnapshotKey(PROJECT_A_CREATED_AT);
        await modules.writeNamedProjectJsonByKey(key, JSON.stringify({ version: CURRENT_PROJECT_VERSION, meta: {} }));
        modules.addToRecentProjects('Uninterpretable', key);

        await expect(modules.collectDurableOwnedAudioBufferIds()).rejects.toThrow(
            'Persisted project snapshot is missing its arrangement tracks.'
        );
    });
});
