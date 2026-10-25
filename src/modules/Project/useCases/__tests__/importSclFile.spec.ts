import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';

type ParseSclResult = Awaited<ReturnType<typeof import('../../repositories/nativeTuning/parseScl').parseScl>>;

const mocks = vi.hoisted(() => {
    let projectValue: ProjectStoreState | null = null;

    return {
        notifyUser: vi.fn<(message: string, type: 'success' | 'error') => void>(),
        parseScl: vi.fn<(content: string) => Promise<ParseSclResult>>(),
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        projectStore: {
            get value(): ProjectStoreState | null {
                return projectValue;
            },
            set value(nextValue: ProjectStoreState | null) {
                projectValue = nextValue;
            },
            set: vi.fn<(nextValue: ProjectStoreState) => void>(),
        },
        registerTuningTable: vi.fn<(frequencies: number[]) => void>(),
    };
});

// Keep engine effects out of the real project-lifetime fixture, and prove the
// import never forwards the table: no instrument consumes project tuning (#4675).
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    registerTuningTable: mocks.registerTuningTable,
}));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn() }));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../repositories/nativeTuning/parseScl', () => ({
    parseScl: mocks.parseScl,
}));

vi.mock('../../stores/projectStore', () => ({
    projectStore: mocks.projectStore,
}));

vi.mock('../fileDialog', () => ({
    pickFiles: mocks.pickFiles,
}));

function createProjectState(): ProjectStoreState {
    return {
        projectId: 'project-a',
        name: 'Session',
        createdAt: 1,
        updatedAt: 2,
        dirty: false,
        loading: false,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: [440],
        },
        initialized: true,
        productionBrief: createDefaultProductionBrief(1),
    };
}

const sclContent = '! comment\nBright twelve\n1\n2/1\n';
const parsedScale: ParseSclResult = {
    status: 'parsed',
    scale: { name: 'Bright twelve', description: 'A test tuning', frequencies: [220, 440, 880] },
};
const invalidScale: ParseSclResult = {
    status: 'invalid',
    error: { kind: 'zero-denominator', line: 5, reason: 'Zero denominator in ratio' },
};
type ImportStage = 'picker' | 'read' | 'parse';
type Replacement = 'prepared' | 'activated' | 'same-id';

async function startPendingImport(stage: ImportStage) {
    const entered = Promise.withResolvers<void>();
    const selection = Promise.withResolvers<File[] | null>();
    const content = Promise.withResolvers<string>();
    const parsed = Promise.withResolvers<ParseSclResult>();
    const file = new File([sclContent], 'bright.scl');
    const readFile = vi.spyOn(file, 'text').mockImplementation(() => {
        if (stage === 'read') {
            entered.resolve();
            return content.promise;
        }
        return Promise.resolve(sclContent);
    });
    mocks.pickFiles.mockImplementation(() => {
        if (stage === 'picker') {
            entered.resolve();
            return selection.promise;
        }
        return Promise.resolve([file]);
    });
    mocks.parseScl.mockImplementation(() => {
        if (stage === 'parse') {
            entered.resolve();
            return parsed.promise;
        }
        return Promise.resolve(parsedScale);
    });

    const importing = importSclFile();
    await entered.promise;
    return {
        importing,
        readFile,
        resolve(result: ParseSclResult = parsedScale): void {
            if (stage === 'picker') {
                selection.resolve([file]);
            } else if (stage === 'read') {
                content.resolve(sclContent);
            } else {
                parsed.resolve(result);
            }
        },
        reject(error: Error): void {
            if (stage === 'picker') {
                selection.reject(error);
            } else if (stage === 'read') {
                content.reject(error);
            } else {
                parsed.reject(error);
            }
        },
    };
}

async function replaceProject(replacement: Replacement) {
    const transaction = runProjectLoadTransaction();
    await expect(transaction.prepare()).resolves.toBe(true);
    if (replacement !== 'prepared') {
        expect(transaction.activate()).toBe(true);
        mocks.projectStore.value = {
            ...createProjectState(),
            projectId: replacement === 'same-id' ? 'project-a' : 'project-b',
            name: 'Successor project',
            tuning: { name: 'Successor tuning', frequencies: [123, 456] },
        };
    }
    return transaction;
}

describe('importSclFile', () => {
    beforeEach(async () => {
        vi.resetAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transaction = runProjectLoadTransaction();
        await expect(transaction.prepare()).resolves.toBe(true);
        expect(transaction.activate()).toBe(true);
        mocks.projectStore.value = createProjectState();
        mocks.projectStore.set.mockImplementation((project) => {
            mocks.projectStore.value = project;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stores the imported scale on the project without forwarding it to the engine', async () => {
        const initialProject = createProjectState();
        const sclContent = '! comment\nBright twelve\n1\n2/1\n';
        const frequencies = [220, 440, 880];
        const selectedFile = new File([sclContent], 'bright.scl', {
            type: 'text/plain',
        });
        mocks.projectStore.value = initialProject;
        mocks.pickFiles.mockResolvedValue([selectedFile]);
        mocks.parseScl.mockResolvedValue({
            status: 'parsed',
            scale: {
                name: 'Bright twelve',
                description: 'A test tuning',
                frequencies,
            },
        });

        await importSclFile();

        expect(mocks.pickFiles).toHaveBeenCalledWith({
            multiple: false,
            filters: [{ name: 'Scala', extensions: ['scl'] }],
        });
        expect(mocks.parseScl).toHaveBeenCalledWith(sclContent);
        expect(mocks.projectStore.set).toHaveBeenCalledWith({
            ...initialProject,
            tuning: {
                name: 'Bright twelve',
                frequencies,
            },
        });
        // No instrument consumes the project tuning table, so there is nothing
        // to register with the engine — forwarding would be the dead call the
        // #4675 fix removed.
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('reports the stored scale and names no instrument as retuned', async () => {
        const sclContent = '! comment\nBright twelve\n1\n2/1\n';
        const selectedFile = new File([sclContent], 'bright.scl', {
            type: 'text/plain',
        });
        mocks.projectStore.value = createProjectState();
        mocks.pickFiles.mockResolvedValue([selectedFile]);
        mocks.parseScl.mockResolvedValue({
            status: 'parsed',
            scale: {
                name: 'Bright twelve',
                description: 'A test tuning',
                frequencies: [220, 440, 880],
            },
        });

        await importSclFile();

        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        const [message, severity] = mocks.notifyUser.mock.calls[0]!;
        // The notice claims only the real effect — storage — never a retune.
        expect(message).toContain('stored on the project');
        expect(message).toContain('no instrument');
        // It names no instrument: nothing honours the table.
        expect(message).not.toContain('Fermenter');
        expect(severity).toBe('success');
    });

    it.each([null, []])('should not parse or notify when no file is selected (%s)', async (selection) => {
        mocks.pickFiles.mockResolvedValue(selection);

        await importSclFile();

        expect(mocks.parseScl).not.toHaveBeenCalled();
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('reports a domain error before any project or engine write', async () => {
        const initialProject = createProjectState();
        const prior = structuredClone(initialProject);
        mocks.projectStore.value = initialProject;
        mocks.pickFiles.mockResolvedValue([new File(['invalid'], 'demo.scl')]);
        mocks.parseScl.mockResolvedValue({
            status: 'invalid',
            error: {
                kind: 'zero-denominator',
                line: 5,
                reason: 'Zero denominator in ratio',
            },
        });

        await importSclFile();

        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Failed to import Scala file at line 5: Zero denominator in ratio',
            'error'
        );
        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    describe.each(['prepared', 'activated', 'same-id'] as const)('after a %s replacement', (replacement) => {
        it.each(['picker', 'read', 'parse'] as const)('ignores a successful pending %s', async (stage) => {
            const pending = await startPendingImport(stage);
            const transaction = await replaceProject(replacement);
            const prior = structuredClone(mocks.projectStore.value);

            pending.resolve();
            await pending.importing;

            expect(mocks.projectStore.value).toEqual(prior);
            expect(mocks.projectStore.set).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(mocks.registerTuningTable).not.toHaveBeenCalled();
            if (stage === 'picker') {
                expect(pending.readFile).not.toHaveBeenCalled();
            }
            if (stage !== 'parse') {
                expect(mocks.parseScl).not.toHaveBeenCalled();
            }
            expect(transaction.activate()).toBe(true);
        });

        it.each(['picker', 'read', 'parse'] as const)('silences a rejected pending %s', async (stage) => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const pending = await startPendingImport(stage);
            const transaction = await replaceProject(replacement);
            const prior = structuredClone(mocks.projectStore.value);

            pending.reject(new Error(`Old ${stage} failed`));
            await pending.importing;

            expect(mocks.projectStore.value).toEqual(prior);
            expect(mocks.projectStore.set).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(mocks.registerTuningTable).not.toHaveBeenCalled();
            expect(consoleError).not.toHaveBeenCalled();
            if (stage === 'picker') {
                expect(pending.readFile).not.toHaveBeenCalled();
            }
            if (stage !== 'parse') {
                expect(mocks.parseScl).not.toHaveBeenCalled();
            }
            expect(transaction.activate()).toBe(true);
        });

        it('silences a pending structured parse error', async () => {
            const pending = await startPendingImport('parse');
            const transaction = await replaceProject(replacement);
            const prior = structuredClone(mocks.projectStore.value);

            pending.resolve(invalidScale);
            await pending.importing;

            expect(mocks.projectStore.value).toEqual(prior);
            expect(mocks.projectStore.set).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(mocks.registerTuningTable).not.toHaveBeenCalled();
            expect(transaction.activate()).toBe(true);
        });
    });

    it.each(['picker', 'read', 'parse'] as const)('reports a current %s failure', async (stage) => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const pending = await startPendingImport(stage);
        const prior = structuredClone(mocks.projectStore.value);
        const failure = new Error(`Current ${stage} failed`);

        pending.reject(failure);
        await pending.importing;

        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith('Failed to import Scala file', 'error');
        expect(consoleError).toHaveBeenCalledExactlyOnceWith('Scala import error:', failure);
        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('keeps the latest ordinary project edits while accepting the imported tuning', async () => {
        const pending = await startPendingImport('parse');
        const editedProject = {
            ...createProjectState(),
            name: 'Renamed while importing',
            updatedAt: 42,
            dirty: true,
        };
        mocks.projectStore.value = editedProject;

        pending.resolve();
        await pending.importing;

        expect(mocks.projectStore.set).toHaveBeenCalledExactlyOnceWith({
            ...editedProject,
            tuning: { name: 'Bright twelve', frequencies: [220, 440, 880] },
        });
        expect(mocks.projectStore.value).toEqual({
            ...editedProject,
            tuning: { name: 'Bright twelve', frequencies: [220, 440, 880] },
        });
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Bright twelve" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('suppresses success when a synchronous store subscriber begins a project replacement', async () => {
        const pending = await startPendingImport('parse');
        const transaction = runProjectLoadTransaction();
        mocks.projectStore.set.mockImplementation((project) => {
            mocks.projectStore.value = project;
            void transaction.prepare();
        });

        pending.resolve();
        await pending.importing;

        expect(mocks.projectStore.set).toHaveBeenCalledOnce();
        expect(mocks.projectStore.value?.tuning).toEqual({
            name: 'Bright twelve',
            frequencies: [220, 440, 880],
        });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
        await expect(transaction.prepare()).resolves.toBe(true);
        expect(transaction.activate()).toBe(true);
    });

    it('does not start the picker while project replacement is prepared', async () => {
        const transaction = await replaceProject('prepared');

        await importSclFile();

        expect(mocks.pickFiles).not.toHaveBeenCalled();
        expect(mocks.parseScl).not.toHaveBeenCalled();
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
        expect(transaction.activate()).toBe(true);
    });

    it('does not apply a tuning when no project exists', async () => {
        mocks.projectStore.value = null;
        mocks.pickFiles.mockResolvedValue([new File([sclContent], 'bright.scl')]);
        mocks.parseScl.mockResolvedValue(parsedScale);

        await importSclFile();

        expect(mocks.projectStore.value).toBeNull();
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });
});
