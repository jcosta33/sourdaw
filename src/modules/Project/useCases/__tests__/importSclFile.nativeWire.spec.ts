import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    notifyUser: vi.fn(),
    pickFiles: vi.fn(),
    projectStore: { value: null as ProjectStoreState | null, set: vi.fn() },
    registerTuningTable: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    registerTuningTable: mocks.registerTuningTable,
}));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn() }));
vi.mock('../../stores/projectStore', () => ({ projectStore: mocks.projectStore }));
vi.mock('../fileDialog', () => ({ pickFiles: mocks.pickFiles }));

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
        initialized: true,
        tuning: { name: 'Existing tuning', frequencies: [440] },
        productionBrief: createDefaultProductionBrief(1),
    };
}

async function activateProject(project: ProjectStoreState): Promise<void> {
    const transaction = runProjectLoadTransaction();
    await expect(transaction.prepare()).resolves.toBe(true);
    expect(transaction.activate()).toBe(true);
    mocks.projectStore.value = project;
}

describe('importSclFile native wire', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    beforeEach(async () => {
        vi.resetAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject(createProjectState());
        mocks.projectStore.set.mockImplementation((project: ProjectStoreState) => {
            mocks.projectStore.value = project;
        });
    });

    it('shows the original line from the real decoder without changing prior tuning', async () => {
        const content = '! demo.scl\nDemo\n! count comment\n1\n3/0\n';
        const prior = structuredClone(mocks.projectStore.value);
        mocks.pickFiles.mockResolvedValue([new File([content], 'demo.scl')]);
        mocks.invoke.mockResolvedValue({
            error: { kind: 'zero-denominator', line: 5, reason: 'Zero denominator in ratio' },
        });
        vi.stubGlobal('sourdaw', { invoke: mocks.invoke });

        await importSclFile();

        expect(mocks.invoke).toHaveBeenCalledWith('parse_scl', [content, 69, 440]);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Failed to import Scala file at line 5: Zero denominator in ratio',
            'error'
        );
        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('stores a current scale decoded through the exact native argument wire', async () => {
        const content = '! demo.scl\nDemo\n1\n2/1\n';
        const initialProject = structuredClone(mocks.projectStore.value);
        mocks.pickFiles.mockResolvedValue([new File([content], 'demo.scl')]);
        mocks.invoke.mockResolvedValue({
            name: 'Demo',
            description: 'A native test tuning',
            frequencies: [220, 440, 880],
        });
        vi.stubGlobal('sourdaw', { invoke: mocks.invoke });

        await importSclFile();

        expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('parse_scl', [content, 69, 440]);
        expect(mocks.projectStore.set).toHaveBeenCalledExactlyOnceWith({
            ...initialProject,
            tuning: { name: 'Demo', frequencies: [220, 440, 880] },
        });
        expect(mocks.projectStore.value).toEqual({
            ...initialProject,
            tuning: { name: 'Demo', frequencies: [220, 440, 880] },
        });
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Demo" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('does not apply a native result after a successor project activates', async () => {
        const content = '! demo.scl\nDemo\n1\n2/1\n';
        const parseEntered = Promise.withResolvers<void>();
        const nativeResult = Promise.withResolvers<unknown>();
        mocks.pickFiles.mockResolvedValue([new File([content], 'demo.scl')]);
        mocks.invoke.mockImplementation(() => {
            parseEntered.resolve();
            return nativeResult.promise;
        });
        vi.stubGlobal('sourdaw', { invoke: mocks.invoke });

        const importing = importSclFile();
        await parseEntered.promise;
        const successor = {
            ...mocks.projectStore.value!,
            projectId: 'project-b',
            name: 'Successor project',
            tuning: { name: 'Successor tuning', frequencies: [123, 456] },
        };
        await activateProject(successor);
        const prior = structuredClone(successor);
        nativeResult.resolve({ name: 'Old scale', description: 'Old scale description', frequencies: [220, 440] });
        await importing;

        expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('parse_scl', [content, 69, 440]);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    describe.each(['prepared', 'activated', 'same-id'] as const)('after a %s replacement', (replacement) => {
        it.each(['parsed', 'invalid', 'rejected'] as const)('ignores a stale native %s result', async (outcome) => {
            const content = '! demo.scl\nDemo\n1\n2/1\n';
            const parseEntered = Promise.withResolvers<void>();
            const nativeResult = Promise.withResolvers<unknown>();
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            mocks.pickFiles.mockResolvedValue([new File([content], 'demo.scl')]);
            mocks.invoke.mockImplementation(() => {
                parseEntered.resolve();
                return nativeResult.promise;
            });
            vi.stubGlobal('sourdaw', { invoke: mocks.invoke });

            const importing = importSclFile();
            await parseEntered.promise;
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
            const prior = structuredClone(mocks.projectStore.value);
            if (outcome === 'parsed') {
                nativeResult.resolve({
                    name: 'Old scale',
                    description: 'Old scale description',
                    frequencies: [220, 440],
                });
            } else if (outcome === 'invalid') {
                nativeResult.resolve({
                    error: { kind: 'zero-denominator', line: 5, reason: 'Zero denominator in ratio' },
                });
            } else {
                nativeResult.reject(new Error('Old native request failed'));
            }
            await importing;

            expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('parse_scl', [content, 69, 440]);
            expect(mocks.projectStore.value).toEqual(prior);
            expect(mocks.projectStore.set).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(mocks.registerTuningTable).not.toHaveBeenCalled();
            expect(consoleError).not.toHaveBeenCalled();
            expect(transaction.activate()).toBe(true);
        });
    });
});
