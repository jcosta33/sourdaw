import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectLoadFailureStore } from '../../../../stores/projectLoadFailureStore';
import { pendingProjectReplacements } from '../../pendingProjectReplacements';
import { pickAndImportProjectFile } from '../pickAndImportProjectFile';

import type { ProjectLoadTransaction } from '../../helpers/runProjectLoadTransaction';

const transactionSentinel: ProjectLoadTransaction = {
    prepare: vi.fn(),
    activate: vi.fn(),
    canActivate: vi.fn(),
    isCurrent: vi.fn(),
    signal: new AbortController().signal,
};

const mocks = vi.hoisted(() => {
    const projectStoreValue: { value: { name: string; createdAt: number; dirty: boolean } | null } = {
        value: null,
    };
    return {
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        runProjectLoadTransaction: vi.fn<() => ProjectLoadTransaction>(),
        applyImportedProjectData: vi.fn<(input: { shouldProceed?: () => boolean }) => Promise<boolean>>(),
        notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
        loggerError: vi.fn<(error: Error) => void>(),
        saveProject: vi.fn<() => Promise<boolean>>(),
        projectStoreValue,
    };
});

const originalMedia = vi.hoisted(() => ({
    restore: vi.fn(),
    activate: vi.fn(),
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    restoreProjectOriginalMedia: originalMedia.restore,
    activateProjectOriginalMedia: originalMedia.activate,
}));

vi.mock('../../../fileDialog', () => ({
    pickFiles: mocks.pickFiles,
}));

vi.mock('../../helpers/runProjectLoadTransaction', () => ({
    runProjectLoadTransaction: mocks.runProjectLoadTransaction,
}));

vi.mock('../applyImportedProjectData', () => ({
    applyImportedProjectData: mocks.applyImportedProjectData,
}));

vi.mock('../../saveProject/saveProject', () => ({
    saveProject: mocks.saveProject,
}));

vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        error: mocks.loggerError,
    },
}));

function makeFile(content: string, name = 'song.sourdaw'): File {
    return new File([content], name);
}

describe('pickAndImportProjectFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        originalMedia.restore.mockResolvedValue(undefined);
        originalMedia.activate.mockResolvedValue(undefined);
        mocks.runProjectLoadTransaction.mockReturnValue(transactionSentinel);
        mocks.saveProject.mockResolvedValue(true);
        mocks.projectStoreValue.value = null;
        projectLoadFailureStore.set(null);
    });

    it('returns false without starting a transaction when no file is selected', async () => {
        mocks.pickFiles.mockResolvedValue(null);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.pickFiles).toHaveBeenCalledWith({
            multiple: false,
            filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
        });
        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('returns false when the picker resolves an empty selection', async () => {
        mocks.pickFiles.mockResolvedValue([]);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('parses the selected file and delegates the decoded data to applyImportedProjectData', async () => {
        const projectJson = { version: 1, meta: { name: 'My Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);

        await expect(pickAndImportProjectFile()).resolves.toBe(true);

        expect(mocks.runProjectLoadTransaction).toHaveBeenCalledTimes(1);
        expect(mocks.applyImportedProjectData).toHaveBeenCalledWith({
            data: projectJson,
            shouldProceed: expect.any(Function),
            transaction: transactionSentinel,
        });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('restores an additive raw-media archive before publishing the imported project', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const hash = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        const data = {
            version: 2,
            meta: {
                projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                name: 'Imported original',
                createdAt: 1,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'Major',
                tuning: { name: '12-TET', frequencies: [] },
            },
            arrangement: {
                tracks: [
                    {
                        id: 'track',
                        name: 'Audio',
                        kind: 'audio',
                        clips: [
                            {
                                id: 'clip',
                                trackId: 'track',
                                name: 'Take',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'audio',
                                bufferId: 'pcm',
                                assetHash: hash,
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
            },
            originalMedia: {
                format: 'sourdaw-original-media-v1',
                assets: [{ hash, bytes: btoa(String.fromCharCode(...bytes)) }],
                unavailable: [],
            },
        };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(data))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);

        await expect(pickAndImportProjectFile()).resolves.toBe(true);

        expect(originalMedia.restore).toHaveBeenCalledExactlyOnceWith(
            data.meta.projectId,
            new Map([[hash, bytes]]),
            expect.any(Function)
        );
        expect(mocks.applyImportedProjectData).toHaveBeenCalledOnce();
        expect(originalMedia.activate).toHaveBeenCalledExactlyOnceWith(
            data.meta.projectId,
            [hash],
            expect.any(Function)
        );
    });

    it.each(['missing', 'extra'] as const)(
        'refuses an archive with %s originals before restoring or replacing the open project',
        async (mismatch) => {
            const bytes = new Uint8Array([1, 2, 3, 4]);
            const hash = `sha256:${'1'.repeat(64)}`;
            const data = {
                version: 2,
                meta: {
                    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    name: 'Imported original',
                    createdAt: 1,
                    updatedAt: 1,
                    keyRoot: 0,
                    scaleName: 'Major',
                    tuning: { name: '12-TET', frequencies: [] },
                },
                arrangement: {
                    tracks: [
                        {
                            id: 'track',
                            name: 'Audio',
                            kind: 'audio',
                            clips: [
                                {
                                    id: 'clip',
                                    trackId: 'track',
                                    name: 'Take',
                                    startBeat: 0,
                                    endBeat: 4,
                                    type: 'audio',
                                    bufferId: 'pcm',
                                    assetHash: hash,
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
                },
                originalMedia: {
                    format: 'sourdaw-original-media-v1',
                    assets: [{ hash, bytes: btoa(String.fromCharCode(...bytes)) }],
                    unavailable: [],
                },
            };
            data.originalMedia.assets =
                mismatch === 'missing'
                    ? []
                    : [
                          ...data.originalMedia.assets,
                          { hash: `sha256:${'2'.repeat(64)}`, bytes: btoa('extra original') },
                      ];
            const openProject = { name: 'Open project', createdAt: 42, dirty: false };
            mocks.projectStoreValue.value = openProject;
            mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(data))]);
            mocks.applyImportedProjectData.mockResolvedValue(true);

            await expect(pickAndImportProjectFile()).resolves.toBe(false);

            expect(originalMedia.restore).not.toHaveBeenCalled();
            expect(originalMedia.activate).not.toHaveBeenCalled();
            expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
            expect(mocks.projectStoreValue.value).toBe(openProject);
            expect(mocks.loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: expect.objectContaining({
                        message: 'Project archive originals differ from its clip references',
                    }),
                })
            );
        }
    );

    it('notifies the user and returns false when the decoded data is rejected as unhydratable', async () => {
        mocks.pickFiles.mockResolvedValue([makeFile('{"version":1}')]);
        mocks.applyImportedProjectData.mockResolvedValue(false);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.notifyUser).toHaveBeenCalledWith('Invalid project file format', 'error');
        expect(mocks.loggerError).not.toHaveBeenCalled();
    });

    /**
     * `applyImportedProjectData` returns false for "unusable file", for
     * "superseded", and for "the open destroyed the session and then failed".
     * Only the first is the file's fault. Telling the user their file is
     * malformed after the third sends them back to the picker to try again
     * while their session is already gone, and buries the real message.
     */
    it('does not blame the file when the open destroyed the session', async () => {
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify({ version: 1 }))]);
        mocks.applyImportedProjectData.mockResolvedValue(false);
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Half Finished Song' });

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.notifyUser).not.toHaveBeenCalledWith('Invalid project file format', 'error');
    });

    it('notifies, logs, and returns false when the file contents are not valid JSON', async () => {
        mocks.pickFiles.mockResolvedValue([makeFile('not-json{{{')]);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to read project file', 'error');
        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Import error', cause: expect.any(SyntaxError) })
        );
    });

    it('notifies and logs when reading the file text rejects', async () => {
        const file = makeFile('irrelevant');
        const readFailure = new Error('disk read failed');
        vi.spyOn(file, 'text').mockRejectedValue(readFailure);
        mocks.pickFiles.mockResolvedValue([file]);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to read project file', 'error');
        expect(mocks.loggerError).toHaveBeenCalledWith(expect.objectContaining({ cause: readFailure }));
    });

    it('pre-saves a dirty open project before replacing it with the import', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: true };

        let resolveSave: ((value: boolean) => void) | undefined;
        mocks.saveProject.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveSave = (value) => {
                        // A fully successful save is what clears the dirty flag.
                        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: false };
                        resolve(value);
                    };
                })
        );

        const importOperation = pickAndImportProjectFile();
        await vi.waitFor(() => expect(mocks.saveProject).toHaveBeenCalledOnce());
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();

        resolveSave?.(true);
        await expect(importOperation).resolves.toBe(true);
        expect(mocks.applyImportedProjectData).toHaveBeenCalledOnce();
    });

    // A save can resolve while the project is still dirty — a plugin state
    // capture rejected before commit warns and keeps that edit uncaptured.
    // Importing over the project would lose the edit exactly as a failed save
    // would, and the capture already told the user why.
    it('aborts the import when the pre-save resolves but leaves the project dirty', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: true };
        mocks.saveProject.mockResolvedValue(true);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('aborts the import when the pre-save of the dirty open project fails', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: true };
        mocks.saveProject.mockResolvedValue(false);

        await expect(pickAndImportProjectFile()).resolves.toBe(false);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
    });

    it('does not pre-save when the open project has no unsaved changes', async () => {
        const projectJson = { version: 1, meta: { name: 'Imported Song' } };
        mocks.pickFiles.mockResolvedValue([makeFile(JSON.stringify(projectJson))]);
        mocks.applyImportedProjectData.mockResolvedValue(true);
        mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: false };

        await expect(pickAndImportProjectFile()).resolves.toBe(true);

        expect(mocks.saveProject).not.toHaveBeenCalled();
    });

    // Choosing the open project's Recent entry while the import is pending
    // withdraws it, so the session stays in the project the user chose last.
    describe('when the open project is chosen while the import is pending', () => {
        it('does not start the import once its pre-save finishes', async () => {
            mocks.pickFiles.mockResolvedValue([makeFile('{"version":1}')]);
            mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: true };
            const save = Promise.withResolvers<boolean>();
            mocks.saveProject.mockImplementationOnce(() => {
                mocks.projectStoreValue.value = { name: 'Open Song', createdAt: 1, dirty: false };
                return save.promise;
            });

            const importOperation = pickAndImportProjectFile();
            await vi.waitFor(() => expect(mocks.saveProject).toHaveBeenCalledOnce());
            pendingProjectReplacements.withdraw();
            save.resolve(true);

            await expect(importOperation).resolves.toBe(false);
            expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
            expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });

        it('does not hand over a file whose read finishes after the choice', async () => {
            const read = Promise.withResolvers<string>();
            const file = makeFile('');
            vi.spyOn(file, 'text').mockReturnValue(read.promise);
            mocks.pickFiles.mockResolvedValue([file]);

            const importOperation = pickAndImportProjectFile();
            await vi.waitFor(() => expect(file.text).toHaveBeenCalledOnce());
            pendingProjectReplacements.withdraw();
            read.resolve('{"version":1}');

            await expect(importOperation).resolves.toBe(false);
            expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });

        it('hands the replacement a check that the choice turns false, and does not blame the file', async () => {
            mocks.pickFiles.mockResolvedValue([makeFile('{"version":1}')]);
            mocks.applyImportedProjectData.mockImplementationOnce(({ shouldProceed }) => {
                expect(shouldProceed?.()).toBe(true);
                pendingProjectReplacements.withdraw();
                return Promise.resolve(shouldProceed?.() ?? true);
            });

            await expect(pickAndImportProjectFile()).resolves.toBe(false);

            expect(mocks.applyImportedProjectData).toHaveBeenCalledOnce();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });
    });
});
