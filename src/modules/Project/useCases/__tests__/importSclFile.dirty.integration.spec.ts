import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { tempoProjectRevisionStore } from '#/modules/Transport/stores';

import { createProjectId } from '../../models/ProjectData';
import references from '../../services/__tests__/fixtures/scalaParity.json';
import { defaultProjectStoreState, projectStore, type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { initProjectDirtyTracking } from '../projectPersistence/saveProject/initProjectDirtyTracking';

const mocks = vi.hoisted(() => ({
    pickFiles: vi.fn<() => Promise<File[] | null>>(),
    notifyUser: vi.fn(),
}));

vi.mock('../fileDialog', () => ({ pickFiles: mocks.pickFiles }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const reference = references.parsed.find((entry) => entry.id === 'mixed')!;

function readStoredTuning(): ProjectStoreState['tuning'] | undefined {
    return getCrdtDoc<{ projectMeta: { tuning: ProjectStoreState['tuning'] } }>('root')?.projectMeta.tuning;
}

describe('Scala import dirty bookkeeping with real project storage', () => {
    let stopDirtyTracking: (() => void) | undefined;
    let bridgeDescriptor: PropertyDescriptor | undefined;

    beforeEach(async () => {
        vi.clearAllMocks();
        bridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');
        Reflect.deleteProperty(window, 'sourdaw');
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Scala dirty tracking');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        flushAutomergeStorageWrites();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transaction = runProjectLoadTransaction();
        await expect(transaction.prepare()).resolves.toBe(true);
        expect(transaction.activate()).toBe(true);
        stopDirtyTracking = initProjectDirtyTracking();
        expect(projectStore.value?.dirty).toBe(false);
        mocks.pickFiles.mockResolvedValue([new File([reference.content], 'valid.scl')]);
    });

    afterEach(() => {
        stopDirtyTracking?.();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        if (bridgeDescriptor) {
            Object.defineProperty(window, 'sourdaw', bridgeDescriptor);
        } else {
            Reflect.deleteProperty(window, 'sourdaw');
        }
    });

    it('marks an imported clean project dirty after committing the real tuning table', async () => {
        await importSclFile();
        flushAutomergeStorageWrites();

        expect(projectStore.value?.tuning.frequencies).toHaveLength(128);
        for (const [note, frequency] of projectStore.value!.tuning.frequencies.entries()) {
            expect(Math.abs(frequency - reference.frequencies[note]!)).toBeLessThan(1e-9);
        }
        expect(readStoredTuning()).toEqual(projectStore.value?.tuning);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Unnamed" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('has an active dirty tracker that responds to a committed tempo notification', () => {
        tempoProjectRevisionStore.set((tempoProjectRevisionStore.value ?? 0) + 1);

        expect(projectStore.value?.dirty).toBe(true);
    });

    it.each(['cancelled', 'invalid'] as const)('leaves a clean project unchanged after %s input', async (input) => {
        const previous = structuredClone(projectStore.value);
        mocks.pickFiles.mockResolvedValue(
            input === 'cancelled' ? null : [new File(['! demo.scl\nDemo\n! count comment\n1\n3/0\n'], 'invalid.scl')]
        );

        await importSclFile();
        flushAutomergeStorageWrites();

        expect(projectStore.value).toEqual(previous);
        expect(readStoredTuning()).toEqual(previous?.tuning);
        if (input === 'cancelled') {
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        } else {
            expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
                'Failed to import Scala file at line 5: Zero denominator in ratio',
                'error'
            );
        }
    });

    it('does not dirty a clean project when a newer cancelled selection supersedes a pending import', async () => {
        const previous = structuredClone(projectStore.value);
        const selection = Promise.withResolvers<File[] | null>();
        mocks.pickFiles.mockReturnValueOnce(selection.promise).mockResolvedValueOnce(null);
        const olderImport = importSclFile();
        expect(mocks.pickFiles).toHaveBeenCalledOnce();

        await importSclFile();
        selection.resolve([new File([reference.content], 'older.scl')]);
        await olderImport;
        flushAutomergeStorageWrites();

        expect(mocks.pickFiles).toHaveBeenCalledTimes(2);
        expect(projectStore.value).toEqual(previous);
        expect(readStoredTuning()).toEqual(previous?.tuning);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it.each(['prepared', 'activated', 'same-id'] as const)(
        'does not dirty the current clean project after a %s replacement',
        async (replacement) => {
            const selection = Promise.withResolvers<File[] | null>();
            mocks.pickFiles.mockReturnValueOnce(selection.promise);
            const importing = importSclFile();
            expect(mocks.pickFiles).toHaveBeenCalledOnce();
            const transaction = runProjectLoadTransaction();
            await expect(transaction.prepare()).resolves.toBe(true);
            if (replacement !== 'prepared') {
                const previousId = projectStore.value?.projectId;
                resetCrdtProjectAuthority('Successor Scala project');
                removeCrdtDoc('root');
                createCrdtDoc('root');
                projectStore.set({
                    ...structuredClone(defaultProjectStoreState),
                    projectId: replacement === 'same-id' ? previousId : createProjectId(),
                    name: 'Successor Scala project',
                    loading: false,
                    initialized: true,
                });
                expect(transaction.activate()).toBe(true);
                flushAutomergeStorageWrites();
            }
            const previous = structuredClone(projectStore.value);
            expect(previous?.dirty).toBe(false);

            selection.resolve([new File([reference.content], 'outgoing.scl')]);
            await importing;
            flushAutomergeStorageWrites();

            expect(projectStore.value).toEqual(previous);
            expect(readStoredTuning()).toEqual(previous?.tuning);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        }
    );

    it('preserves the loading guard while storing a current import', async () => {
        projectStore.set({ ...projectStore.value!, loading: true });

        await importSclFile();
        flushAutomergeStorageWrites();

        expect(projectStore.value).toMatchObject({ dirty: false, loading: true });
        expect(projectStore.value?.tuning.name).toBe(reference.name);
        expect(readStoredTuning()).toEqual(projectStore.value?.tuning);
    });

    it('does not add dirty bookkeeping when the project is already dirty', async () => {
        projectStore.set({ ...projectStore.value!, dirty: true });
        const setProject = vi.spyOn(projectStore, 'set');

        await importSclFile();
        flushAutomergeStorageWrites();

        expect(setProject).toHaveBeenCalledOnce();
        expect(projectStore.value?.dirty).toBe(true);
        expect(projectStore.value?.tuning.name).toBe(reference.name);
        expect(readStoredTuning()).toEqual(projectStore.value?.tuning);
    });

    it('suppresses success when a dirty subscriber starts a newer import in the same project', async () => {
        let newerImport: Promise<void> | undefined;
        const unsubscribe = projectStore.subscribe((project) => {
            if (!newerImport && project?.dirty) {
                mocks.pickFiles.mockResolvedValueOnce(null);
                newerImport = importSclFile();
            }
        });
        try {
            await importSclFile();
            expect(newerImport).toBeDefined();
            await newerImport;
            flushAutomergeStorageWrites();

            expect(mocks.pickFiles).toHaveBeenCalledTimes(2);
            expect(projectStore.value?.dirty).toBe(true);
            expect(readStoredTuning()).toEqual(projectStore.value?.tuning);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });

    it.each(['tuning', 'dirty'] as const)(
        'suppresses success when a synchronous %s subscriber prepares a replacement',
        async (publication) => {
            const transaction = runProjectLoadTransaction();
            let preparation: Promise<boolean> | undefined;
            const unsubscribe = projectStore.subscribe((project) => {
                if (
                    !preparation &&
                    project?.tuning.name === reference.name &&
                    project.dirty === (publication === 'dirty')
                ) {
                    preparation = transaction.prepare();
                }
            });
            try {
                await importSclFile();
                flushAutomergeStorageWrites();

                expect(preparation).toBeDefined();
                await expect(preparation).resolves.toBe(true);
                expect(projectStore.value?.tuning.name).toBe(reference.name);
                expect(readStoredTuning()).toEqual(projectStore.value?.tuning);
                expect(projectStore.value?.dirty).toBe(publication === 'dirty');
                expect(mocks.notifyUser).not.toHaveBeenCalled();
            } finally {
                unsubscribe();
            }
        }
    );
});
