import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import references from '../../services/__tests__/fixtures/scalaParity.json';
import { type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    projectStore: { value: null as ProjectStoreState | null, set: vi.fn() },
    registerTuningTable: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('../../stores/projectStore', () => ({ projectStore: mocks.projectStore }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    registerTuningTable: mocks.registerTuningTable,
}));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn() }));

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
    expect(transaction.isCurrent()).toBe(true);
    mocks.projectStore.value = project;
}

function selectBrowserFile(file: File | null) {
    return vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
        expect(this.type).toBe('file');
        expect(this.accept).toBe('.scl');
        Object.defineProperty(this, 'files', { configurable: true, value: file ? [file] : [] });
        this.dispatchEvent(new Event(file ? 'change' : 'cancel'));
    });
}

function expectFrequencies(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(128);
    for (const [index, frequency] of actual.entries()) {
        expect(Number.isFinite(frequency)).toBe(true);
        expect(frequency).toBeGreaterThan(0);
        expect(Math.abs(frequency - expected[index]!)).toBeLessThan(1e-9);
    }
}

async function startPendingBrowserRead() {
    const reference = references.parsed.find((entry) => entry.id === 'mixed')!;
    const file = new File([reference.content], 'browser.scl');
    const originalRead = file.text.bind(file);
    const entered = Promise.withResolvers<void>();
    const permission = Promise.withResolvers<void>();
    vi.spyOn(file, 'text').mockImplementation(async () => {
        entered.resolve();
        await permission.promise;
        return originalRead();
    });
    const picker = selectBrowserFile(file);
    const importing = importSclFile();
    await entered.promise;
    expect(picker).toHaveBeenCalledOnce();
    return { importing, permission, reference };
}

async function replaceProject(replacement: 'prepared' | 'activated' | 'same-id') {
    const transaction = runProjectLoadTransaction();
    await expect(transaction.prepare()).resolves.toBe(true);
    if (replacement !== 'prepared') {
        expect(transaction.activate()).toBe(true);
        mocks.projectStore.value = {
            ...createProjectState(),
            projectId: replacement === 'same-id' ? 'project-a' : 'project-b',
            name: 'Successor',
            tuning: { name: 'Successor tuning', frequencies: [123, 456] },
        };
    }
    return transaction;
}

describe('importSclFile browser', () => {
    let bridgeDescriptor: PropertyDescriptor | undefined;

    beforeEach(async () => {
        vi.resetAllMocks();
        bridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');
        Reflect.deleteProperty(window, 'sourdaw');
        expect('sourdaw' in window).toBe(false);
        expect(isDesktopRuntime()).toBe(false);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject(createProjectState());
        mocks.projectStore.set.mockImplementation((project: ProjectStoreState) => {
            mocks.projectStore.value = project;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (bridgeDescriptor) {
            Object.defineProperty(window, 'sourdaw', bridgeDescriptor);
        } else {
            Reflect.deleteProperty(window, 'sourdaw');
        }
    });

    it('stores a Scala scale in the browser without a desktop bridge', async () => {
        const reference = references.parsed.find((entry) => entry.id === 'mixed')!;
        const file = new File([reference.content], 'browser.scl');
        const readFile = vi.spyOn(file, 'text');
        const picker = selectBrowserFile(file);

        await importSclFile();

        expect(picker).toHaveBeenCalledOnce();
        expect(readFile).toHaveBeenCalledOnce();
        expect(console.error).not.toHaveBeenCalled();
        expect(mocks.projectStore.set).toHaveBeenCalledOnce();
        expect(mocks.projectStore.value?.tuning.name).toBe(reference.name);
        expectFrequencies(mocks.projectStore.value!.tuning.frequencies, reference.frequencies);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Unnamed" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('reports the native physical-line diagnostic without changing tuning', async () => {
        const prior = structuredClone(mocks.projectStore.value);
        selectBrowserFile(new File(['! demo.scl\nDemo\n! count comment\n1\n3/0\n'], 'invalid.scl'));

        await importSclFile();

        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Failed to import Scala file at line 5: Zero denominator in ratio',
            'error'
        );
        expect(console.error).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('leaves prior tuning unchanged when the real browser picker is cancelled', async () => {
        const prior = structuredClone(mocks.projectStore.value);
        const picker = selectBrowserFile(null);

        await importSclFile();

        expect(picker).toHaveBeenCalledOnce();
        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('does not apply a browser scale when no project exists', async () => {
        mocks.projectStore.value = null;
        selectBrowserFile(new File(['Unison\n1\n1/1\n'], 'unison.scl'));

        await importSclFile();

        expect(mocks.projectStore.value).toBeNull();
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it.each(['prepared', 'activated', 'same-id'] as const)(
        'refuses a browser read after a %s project replacement',
        async (replacement) => {
            const pending = await startPendingBrowserRead();
            const transaction = await replaceProject(replacement);
            const prior = structuredClone(mocks.projectStore.value);

            pending.permission.resolve();
            await pending.importing;

            expect(mocks.projectStore.value).toEqual(prior);
            expect(mocks.projectStore.set).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(console.error).not.toHaveBeenCalled();
            expect(mocks.registerTuningTable).not.toHaveBeenCalled();
            expect(transaction.activate()).toBe(true);
        }
    );

    it.each(['prepared', 'same-id'] as const)(
        'silences a rejected browser read after %s replacement',
        async (replacement) => {
            const pending = await startPendingBrowserRead();
            const transaction = await replaceProject(replacement);
            const prior = structuredClone(mocks.projectStore.value);

            pending.permission.reject(new Error('Old browser read failed'));
            await pending.importing;

            expect(mocks.projectStore.value).toEqual(prior);
            expect(mocks.projectStore.set).not.toHaveBeenCalled();
            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(console.error).not.toHaveBeenCalled();
            expect(mocks.registerTuningTable).not.toHaveBeenCalled();
            expect(transaction.activate()).toBe(true);
        }
    );

    it('retains ordinary edits made while the browser reads the file', async () => {
        const pending = await startPendingBrowserRead();
        const edited = { ...createProjectState(), name: 'Renamed', updatedAt: 42, dirty: true };
        mocks.projectStore.value = edited;

        pending.permission.resolve();
        await pending.importing;

        expect(mocks.projectStore.set).toHaveBeenCalledExactlyOnceWith({
            ...edited,
            tuning: { name: pending.reference.name, frequencies: expect.any(Array) },
        });
        expectFrequencies(mocks.projectStore.value.tuning.frequencies, pending.reference.frequencies);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Imported scale "Unnamed" — stored on the project; no instrument consumes project tuning yet',
            'success'
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('keeps a present but broken desktop marker on the native failure route', async () => {
        Object.defineProperty(window, 'sourdaw', { configurable: true, value: undefined });
        expect(isDesktopRuntime()).toBe(true);
        const prior = structuredClone(mocks.projectStore.value);
        selectBrowserFile(new File(['Unison\n1\n1/1\n'], 'unison.scl'));

        await importSclFile();

        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith('Failed to import Scala file', 'error');
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
            'Scala import error:',
            expect.objectContaining({ message: 'Sourdaw desktop bridge is not available' })
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('refuses an unrepresentable browser table without a partial tuning or success notice', async () => {
        const prior = structuredClone(mocks.projectStore.value);
        selectBrowserFile(new File(['Huge\n1\n1.0e308\n'], 'huge.scl'));

        await importSclFile();

        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith('Failed to import Scala file', 'error');
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
            'Scala import error:',
            expect.objectContaining({ message: expect.stringContaining('Scale produces a non-finite frequency') })
        );
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });
});
