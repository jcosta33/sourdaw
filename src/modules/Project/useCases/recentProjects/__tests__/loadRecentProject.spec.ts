import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { resetCrdtProjectAuthority, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { ensureTrackStrips } from '#/modules/Transport/useCases';

import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { readNamedProjectJson } from '../../../repositories/project/readNamedProjectJson';
import { writeProjectJson } from '../../../repositories/project/writeProjectJson';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { hydrateArrangementStoreFromProjectData } from '../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../../projectPersistence/helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../../projectPersistence/projectIdentityTransitionDependencies';
import { loadRecentProject } from '../loadRecentProject';

const { audioContext } = vi.hoisted(() => ({
    audioContext: { id: 'audio-context' },
}));

vi.mock('../../../repositories/project/readNamedProjectJson', () => ({
    readNamedProjectJson: vi.fn(),
}));

vi.mock('../../../repositories/project/writeProjectJson', () => ({
    writeProjectJson: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({ ensureTrackStrips: vi.fn(), stopPlayback: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(() => audioContext),
    importCachedAudioBuffers: vi.fn().mockResolvedValue({ persist: () => Promise.resolve(true), publish: () => 0 }),
    prepareCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue({ publish: () => 0 }),
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject: vi.fn().mockResolvedValue(undefined),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
    resetCrdtProjectAuthority: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
}));
vi.mock('../../projectPersistence/helpers/autoSaveHandle', () => ({ setAutoSaveHandle: vi.fn() }));
vi.mock('../../projectPersistence/helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: vi.fn() }));
vi.mock('../../projectPersistence/helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
}));
vi.mock('../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData', () => ({
    hydrateArrangementStoreFromProjectData: vi.fn(),
}));
vi.mock('../../projectPersistence/helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));
vi.mock('../../projectPersistence/helpers/verifyAudioBufferReferences', () => ({
    verifyAudioBufferReferences: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const validProjectData = {
    version: CURRENT_PROJECT_VERSION,
    meta: {
        name: 'Large Project',
        createdAt: 1,
        updatedAt: 2,
        keyRoot: 0,
        scaleName: 'major',
        tuning: { name: '12-TET', frequencies: [] },
    },
    arrangement: { tracks: [] },
    audioBuffers: {
        'embedded-buffer': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
    },
};
const validProject = JSON.stringify(validProjectData);

describe('loadRecentProject', () => {
    beforeEach(() => {
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        vi.mocked(readNamedProjectJson).mockReset();
        vi.mocked(writeProjectJson).mockClear();
        vi.mocked(startCrdtAutoSave).mockClear();
        vi.mocked(ensureTrackStrips).mockClear();
        vi.mocked(resetAudioGraph).mockReset();
        vi.mocked(hydrateModuleStoresFromProjectData).mockClear();
        vi.mocked(hydrateArrangementStoreFromProjectData).mockClear();
        vi.mocked(resetModuleStoresToDefault).mockReset();
        vi.mocked(getAudioContext).mockClear();
        vi.mocked(importCachedAudioBuffers)
            .mockReset()
            .mockResolvedValue({ persist: () => Promise.resolve(true), publish: () => 0 });
        vi.mocked(prepareCachedAudioBuffersFromIdb)
            .mockReset()
            .mockResolvedValue({ publish: () => 0 });
    });

    it('loads a named project that resolves only from the IndexedDB fallback', async () => {
        // readNamedProjectJson is the async, IDB-aware read: localStorage was
        // empty (quota-dropped dual-write) and the value came back from IDB.
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);

        const ok = await loadRecentProject('sourdaw:project:Large Project');

        expect(ok).toBe('committed');
        expect(readNamedProjectJson).toHaveBeenCalledWith('sourdaw:project:Large Project');
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledTimes(1);
        const arrangementHydration = vi.mocked(hydrateArrangementStoreFromProjectData).mock.calls[0]?.[0];
        expect(arrangementHydration?.data.version).toBe(CURRENT_PROJECT_VERSION);
        expect(arrangementHydration?.preserveSavedArrangements).toBe(true);
        expect(writeProjectJson).toHaveBeenCalledWith(validProject);
        expect(getAudioContext).toHaveBeenCalledTimes(1);
        const restoreInput = vi.mocked(prepareCachedAudioBuffersFromIdb).mock.calls[0]?.[0];
        expect(restoreInput?.audioContext).toBe(audioContext);
        expect(restoreInput?.shouldContinue?.()).toBe(true);
        const importInput = vi.mocked(importCachedAudioBuffers).mock.calls[0]?.[0];
        expect(importInput).toMatchObject({
            audioContext,
            buffers: validProjectData.audioBuffers,
        });
        expect(importInput?.shouldContinue?.()).toBe(true);
    });

    it('keeps the committed project live when post-commit embedded persistence fails', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        const persistEmbedded = vi.fn().mockResolvedValue(false);
        const publishEmbedded = vi.fn(() => 0);
        vi.mocked(importCachedAudioBuffers).mockResolvedValueOnce({
            persist: persistEmbedded,
            publish: publishEmbedded,
        });

        await expect(loadRecentProject('embedded-persist-failure')).resolves.toBe('committed');

        expect(persistEmbedded).toHaveBeenCalledOnce();
        expect(publishEmbedded).toHaveBeenCalledOnce();
        expect(publishEmbedded.mock.invocationCallOrder[0]).toBeLessThan(persistEmbedded.mock.invocationCallOrder[0]!);
        expect(resetAudioGraph).toHaveBeenCalledOnce();
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledOnce();
    });

    it('starts the committed project durability lifecycle', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);

        await expect(loadRecentProject('crdt-persist-failure')).resolves.toBe('committed');

        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('does not falsify a committed load when recent-project publication throws', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        vi.mocked(writeProjectJson).mockImplementationOnce(() => {
            throw new Error('recent JSON write failed');
        });

        await expect(loadRecentProject('recent-write-failure')).resolves.toBe('committed');

        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('aborts and restores the previous graph when reset fails before state publication', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        const order: string[] = [];
        const persistEmbedded = vi.fn(() => {
            order.push('persist');
            return Promise.resolve(true);
        });
        const publishEmbedded = vi.fn(() => {
            order.push('publish');
            return 1;
        });
        vi.mocked(importCachedAudioBuffers).mockResolvedValueOnce({
            persist: persistEmbedded,
            publish: publishEmbedded,
        });
        vi.mocked(resetAudioGraph).mockImplementationOnce(() => {
            order.push('reset');
            throw new Error('graph reset failed');
        });

        await expect(loadRecentProject('reset-failure')).resolves.toBe('aborted');

        expect(order).toEqual(['reset']);
        expect(publishEmbedded).not.toHaveBeenCalled();
        expect(persistEmbedded).not.toHaveBeenCalled();
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
        // Restoring "the previous graph" includes the transient flags. This line
        // used to pin `{ loading: true, initialized: false }` — the flags the
        // aborted load claimed on entry and never gave back, which left the
        // loading overlay up and `markDirty` permanently short-circuited.
        expect(projectStore.value).toMatchObject({ loading: false, initialized: true });
    });

    it('continues the committed replacement after a mid-commit store reset failure', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        vi.mocked(resetModuleStoresToDefault).mockImplementationOnce(() => {
            throw new Error('device store reset failed');
        });

        await expect(loadRecentProject('mid-commit-failure')).resolves.toBe('committed');

        expect(hydrateArrangementStoreFromProjectData).toHaveBeenCalledOnce();
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('restores only buffers referenced by the candidate project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(
            JSON.stringify({
                ...validProjectData,
                arrangement: {
                    tracks: [
                        {
                            id: 'track-1',
                            name: 'Track 1',
                            kind: 'audio',
                            clips: [
                                {
                                    id: 'clip-1',
                                    trackId: 'track-1',
                                    name: 'Clip 1',
                                    type: 'audio',
                                    bufferId: 'candidate-buffer',
                                    startBeat: 0,
                                    endBeat: 1,
                                    fadeInBeats: 0,
                                    fadeOutBeats: 0,
                                    gain: 1,
                                    color: '#fff',
                                    locked: false,
                                    muted: false,
                                },
                            ],
                            alternatives: [],
                            freezeState: { status: 'unfrozen' },
                            midiFx: [],
                        },
                    ],
                },
            })
        );

        await expect(loadRecentProject('candidate')).resolves.toBe('committed');

        expect(vi.mocked(prepareCachedAudioBuffersFromIdb).mock.calls[0]?.[0]?.bufferIds).toEqual(['candidate-buffer']);
    });

    it('resets the per-device-instance stores (§13.1) before hydrating, to avoid leaking the previous project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);

        const ok = await loadRecentProject('sourdaw:project:Large Project');

        expect(ok).toBe('committed');
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        // The reset must precede hydration so device stores are blank before the
        // loaded project's non-device state is written over them.
        const resetOrder = vi.mocked(resetModuleStoresToDefault).mock.invocationCallOrder[0];
        const hydrateOrder = vi.mocked(hydrateModuleStoresFromProjectData).mock.invocationCallOrder[0];
        if (resetOrder === undefined || hydrateOrder === undefined) {
            throw new Error('expected both reset and hydration to have been called');
        }
        expect(resetOrder).toBeLessThan(hydrateOrder);
    });

    it('restores cached audio buffers before publishing hydrated tracks', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        let completeRestore: (() => void) | undefined;
        vi.mocked(prepareCachedAudioBuffersFromIdb).mockImplementationOnce(
            () =>
                new Promise<{ publish: () => number }>((resolve) => {
                    completeRestore = () => resolve({ publish: () => 0 });
                })
        );

        const loading = loadRecentProject('sourdaw:project:Large Project');
        await vi.waitFor(() => expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1));

        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        const finishRestore = completeRestore;
        if (!finishRestore) {
            throw new Error('Expected pending audio-buffer restoration');
        }
        finishRestore();
        await expect(loading).resolves.toBe('committed');
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledTimes(1);
    });

    it('returns false when neither localStorage nor IndexedDB has the project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(null);

        const ok = await loadRecentProject('missing');

        expect(ok).toBe('not-found');
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        // No project was replaced, so the device-store reset must not fire either.
        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
    });

    /**
     * `aborted` tells the caller a newer transition owns the project now and it
     * should do nothing. A load that destroyed the previous session and then
     * failed is the opposite: nothing owns the project and no successor is
     * coming. Collapsing the two hid that from every caller.
     */
    it('reports a load that destroyed the session as failed, not aborted', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        vi.mocked(resetCrdtProjectAuthority).mockImplementationOnce(
            (_name: string, onAuthorityReplaced?: () => void): void => {
                onAuthorityReplaced?.();
                throw new DOMException('exceeded the quota', 'QuotaExceededError');
            }
        );

        await expect(loadRecentProject('reset-failure')).resolves.toBe('failed');
    });

    it('leaves the live project untouched when recent-project parsing fails', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue('{invalid-json');

        await expect(loadRecentProject('invalid')).resolves.toBe('failed');

        expect(resetAudioGraph).not.toHaveBeenCalled();
        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
    });

    it('supersedes an older overlapping load with the latest request', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        let completeFirstRestore: (() => void) | undefined;
        vi.mocked(prepareCachedAudioBuffersFromIdb)
            .mockImplementationOnce(
                () =>
                    new Promise<{ publish: () => number }>((resolve) => {
                        completeFirstRestore = () => resolve({ publish: () => 0 });
                    })
            )
            .mockResolvedValueOnce({ publish: () => 0 });

        const firstLoad = loadRecentProject('first-project');
        const secondLoad = loadRecentProject('second-project');
        await vi.waitFor(() => expect(completeFirstRestore).toBeDefined());

        const finishFirstRestore = completeFirstRestore;
        if (!finishFirstRestore) {
            throw new Error('Expected first project restoration to be pending');
        }
        finishFirstRestore();
        await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual(['aborted', 'committed']);

        expect(readNamedProjectJson).toHaveBeenCalledTimes(2);
        expect(readNamedProjectJson).toHaveBeenNthCalledWith(1, 'first-project');
        expect(readNamedProjectJson).toHaveBeenNthCalledWith(2, 'second-project');
    });

    it('keeps request order authoritative when an older project read resolves last', async () => {
        let finishFirstRead: (() => void) | undefined;
        vi.mocked(readNamedProjectJson).mockImplementation(
            (key) =>
                new Promise<string>((resolve) => {
                    if (key === 'first-project') {
                        finishFirstRead = () => resolve(validProject);
                        return;
                    }
                    resolve(validProject);
                })
        );

        const firstLoad = loadRecentProject('first-project');
        const secondLoad = loadRecentProject('second-project');
        await expect(secondLoad).resolves.toBe('committed');

        const finishRead = finishFirstRead;
        if (!finishRead) {
            throw new Error('Expected the first project read to be pending');
        }
        finishRead();

        await expect(firstLoad).resolves.toBe('aborted');
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledOnce();
    });

    it('does not publish after a newer project transition starts', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        let completeRestore: (() => void) | undefined;
        vi.mocked(prepareCachedAudioBuffersFromIdb).mockImplementationOnce(
            () =>
                new Promise<{ publish: () => number }>((resolve) => {
                    completeRestore = () => resolve({ publish: () => 0 });
                })
        );

        const loading = loadRecentProject('old-project');
        await vi.waitFor(() => expect(completeRestore).toBeDefined());
        const newerLoad = runProjectLoadTransaction();
        await newerLoad.prepare();
        newerLoad.activate();

        const finishRestore = completeRestore;
        if (!finishRestore) {
            throw new Error('Expected pending audio-buffer restoration');
        }
        finishRestore();

        await expect(loading).resolves.toBe('aborted');
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        expect(hydrateArrangementStoreFromProjectData).not.toHaveBeenCalled();
    });

    it('does not let a missing newer request cancel a valid prepared load', async () => {
        vi.mocked(readNamedProjectJson).mockImplementation((key) =>
            Promise.resolve(key === 'missing-project' ? null : validProject)
        );
        let completeRestore: (() => void) | undefined;
        vi.mocked(prepareCachedAudioBuffersFromIdb).mockImplementationOnce(
            () =>
                new Promise<{ publish: () => number }>((resolve) => {
                    completeRestore = () => resolve({ publish: () => 0 });
                })
        );

        const validLoad = loadRecentProject('valid-project');
        await vi.waitFor(() => expect(completeRestore).toBeDefined());
        await expect(loadRecentProject('missing-project')).resolves.toBe('not-found');

        const finishRestore = completeRestore;
        if (!finishRestore) {
            throw new Error('Expected pending audio-buffer restoration');
        }
        finishRestore();

        await expect(validLoad).resolves.toBe('committed');
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledTimes(1);
    });
});
