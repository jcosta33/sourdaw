import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import references from '../../services/__tests__/fixtures/scalaParity.json';
import { type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';

const mocks = vi.hoisted(() => ({
    dialogOpen: vi.fn(),
    invoke: vi.fn(),
    invokeBinaryResponse: vi.fn(),
    notifyUser: vi.fn(),
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

function createDesktopBridge() {
    return {
        dialog: { open: mocks.dialogOpen },
        invoke: mocks.invoke,
        invokeBinaryResponse: mocks.invokeBinaryResponse,
    };
}

function expectExactFrequencies(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(128);
    expect(actual).toEqual(expected);
}

describe('importSclFile native selected-file reads', () => {
    let bridgeDescriptor: PropertyDescriptor | undefined;

    beforeEach(async () => {
        vi.resetAllMocks();
        bridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject(createProjectState());
        mocks.projectStore.set.mockImplementation((project: ProjectStoreState) => {
            mocks.projectStore.value = project;
        });
        Object.defineProperty(window, 'sourdaw', { configurable: true, value: createDesktopBridge() });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (bridgeDescriptor) {
            Object.defineProperty(window, 'sourdaw', bridgeDescriptor);
        } else {
            Reflect.deleteProperty(window, 'sourdaw');
        }
    });

    it('keeps B when its native file read and parse finish before A', async () => {
        const first = references.parsed.find((entry) => entry.id === 'mixed')!;
        const second = references.parsed.find((entry) => entry.id === 'ratios-and-integer-period')!;
        const firstReadEntered = Promise.withResolvers<void>();
        const firstRead = Promise.withResolvers<Uint8Array>();
        mocks.dialogOpen.mockResolvedValueOnce('/scales/A.scl').mockResolvedValueOnce('/scales/B.scl');
        mocks.invokeBinaryResponse.mockImplementation(async (command: string, args: unknown[]) => {
            expect(command).toBe('read_file_bytes');
            if (args[0] === '/scales/A.scl') {
                firstReadEntered.resolve();
                return firstRead.promise;
            }
            expect(args[0]).toBe('/scales/B.scl');
            return new TextEncoder().encode(second.content);
        });
        mocks.invoke.mockImplementation(async (command: string, args: unknown[]) => {
            expect(command).toBe('parse_scl');
            const content = args[0];
            const result = content === first.content ? first : second;
            return { name: result.name, description: result.description, frequencies: result.frequencies };
        });

        const firstImport = importSclFile();
        await firstReadEntered.promise;
        const secondImport = importSclFile();
        await secondImport;
        firstRead.resolve(new TextEncoder().encode(first.content));
        await firstImport;

        expect(mocks.dialogOpen).toHaveBeenCalledTimes(2);
        expect(mocks.dialogOpen).toHaveBeenNthCalledWith(1, {
            multiple: false,
            filters: [{ name: 'Scala', extensions: ['scl'] }],
        });
        expect(mocks.invokeBinaryResponse).toHaveBeenNthCalledWith(1, 'read_file_bytes', ['/scales/A.scl']);
        expect(mocks.invokeBinaryResponse).toHaveBeenNthCalledWith(2, 'read_file_bytes', ['/scales/B.scl']);
        expect(mocks.invokeBinaryResponse).toHaveBeenCalledTimes(2);
        expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('parse_scl', [second.content, 69, 440]);
        expect(mocks.projectStore.set).toHaveBeenCalledOnce();
        expectExactFrequencies(mocks.projectStore.value!.tuning.frequencies, second.frequencies);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Unnamed" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('silences an older native file read failure after B completes', async () => {
        const second = references.parsed.find((entry) => entry.id === 'ratios-and-integer-period')!;
        const firstReadEntered = Promise.withResolvers<void>();
        const firstRead = Promise.withResolvers<Uint8Array>();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.dialogOpen.mockResolvedValueOnce('/scales/A.scl').mockResolvedValueOnce('/scales/B.scl');
        mocks.invokeBinaryResponse.mockImplementation(async (_command: string, args: unknown[]) => {
            if (args[0] === '/scales/A.scl') {
                firstReadEntered.resolve();
                return firstRead.promise;
            }
            return new TextEncoder().encode(second.content);
        });
        mocks.invoke.mockResolvedValue({
            name: second.name,
            description: second.description,
            frequencies: second.frequencies,
        });

        const firstImport = importSclFile();
        await firstReadEntered.promise;
        await importSclFile();
        firstRead.reject(new Error('Old native file read failed'));
        await firstImport;

        expect(mocks.dialogOpen).toHaveBeenCalledTimes(2);
        expect(mocks.invokeBinaryResponse).toHaveBeenNthCalledWith(1, 'read_file_bytes', ['/scales/A.scl']);
        expect(mocks.invokeBinaryResponse).toHaveBeenNthCalledWith(2, 'read_file_bytes', ['/scales/B.scl']);
        expect(mocks.invokeBinaryResponse).toHaveBeenCalledTimes(2);
        expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('parse_scl', [second.content, 69, 440]);
        expect(mocks.projectStore.set).toHaveBeenCalledOnce();
        expectExactFrequencies(mocks.projectStore.value!.tuning.frequencies, second.frequencies);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Unnamed" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(consoleError).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });
});
