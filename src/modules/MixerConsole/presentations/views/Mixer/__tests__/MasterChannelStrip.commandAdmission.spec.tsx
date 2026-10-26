import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    undo,
    redo,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    recordActionHistoryEntry,
    markActionHistoryEntryReverted,
    clearActionHistory,
} from '#/modules/CrdtDocument/useCases';
import {
    captureProjectTransitionAuthority,
    runProjectLoadTransaction,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { dbToGain, formatGainDb } from '#/utils/audioLevelLaw';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { MasterChannelStrip } from '../MasterChannelStrip';

const external = vi.hoisted(() => ({
    promptUser: vi.fn<() => Promise<string | null>>(),
    setMasterGainValue: vi.fn<(value: number) => void>(),
    notification: vi.fn(async () => undefined),
}));

vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: external.promptUser }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    setMasterGainValue: external.setMasterGainValue,
}));
vi.mock('../MixerLevelReadout', () => ({
    MixerLevelReadout: ({ control, value }: { control: React.ReactNode; value: string }) => (
        <>
            {control}
            <output>{value}</output>
        </>
    ),
}));

async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

describe('MasterChannelStrip command admission', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.spyOn(logger, 'error');
        injectDependencies(notifyUser, { eventBus: { emit: external.notification, on: () => () => undefined } });
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        transportStore.set({ ...defaultTransportState, masterGain: 80 });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
        external.promptUser.mockResolvedValue('0 dB');
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        expect(logger.error).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it.each([false, true])(
        'admits the typed entry only while its real Project authority survives the real Command snapshot wait (replace=%s)',
        async (replaceProject) => {
            const enteredWait = Promise.withResolvers<void>();
            const snapshot = Promise.withResolvers<void>();
            configureAutomergeStoragePort({
                getDoc: () => undefined,
                getSemanticMessage: () => undefined,
                hasDoc: () => false,
                mutateDoc: () => undefined,
                waitForSnapshotTransaction: () => {
                    enteredWait.resolve();
                    return snapshot.promise;
                },
            });
            const handler = getTransportHandlers().setMasterGain;
            const execute = vi.spyOn(handler, 'execute');
            registerHandlerMap({ setMasterGain: handler });
            const authority = captureProjectTransitionAuthority();
            render(<MasterChannelStrip widthClass="w-36" />);
            const slider = screen.getByRole('slider', { name: 'Master gain' });

            await act(async () => {
                fireEvent.contextMenu(slider);
            });
            await act(async () => {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
                await enteredWait.promise;
            });
            expect(authority.isCurrent()).toBe(true);
            expect(execute).not.toHaveBeenCalled();
            expect(external.setMasterGainValue).toHaveBeenLastCalledWith(1);

            if (replaceProject) {
                await activateProject();
                // Equal gain deliberately defeats an expectedPercent-only guard.
                expect(transportStore.value?.masterGain).toBe(80);
                expect(authority.isCurrent()).toBe(false);
            }
            external.setMasterGainValue.mockClear();
            await act(async () => {
                snapshot.resolve();
                await snapshot.promise;
            });
            await waitFor(() => expect(external.setMasterGainValue).toHaveBeenCalled());

            expect(execute).toHaveBeenCalledTimes(replaceProject ? 0 : 1);
            expect(external.setMasterGainValue).toHaveBeenLastCalledWith(replaceProject ? 0.8 : 1);
            expect(slider).toHaveAttribute('aria-valuenow', replaceProject ? '0.8' : '1');
        }
    );
});

type RawProject = {
    transport: typeof defaultTransportState;
    actionHistory: { entries: unknown[] };
    [key: string]: unknown;
};

function installProjectPort(
    waitForSnapshotTransaction: () => Promise<void>,
    masterGain = 80
): { read: () => RawProject } {
    let document: RawProject = {
        transport: { ...defaultTransportState, masterGain },
        actionHistory: { entries: [] },
    };
    configureAutomergeStoragePort({
        getDoc: () => document,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            const next = structuredClone(document);
            changeFn(next);
            document = next;
        },
        waitForSnapshotTransaction,
    });
    transportStore.hydrate();
    actionHistoryStore.hydrate();
    setActionHistoryMetadataPort({
        record: recordActionHistoryEntry,
        markReverted: markActionHistoryEntryReverted,
        clear: clearActionHistory,
    });
    const handlers = getTransportHandlers();
    registerHandlerMap({ setMasterGain: handlers.setMasterGain, restoreMasterGain: handlers.restoreMasterGain });
    return { read: () => document };
}

async function typeEntry(input = '0 dB'): Promise<void> {
    external.promptUser.mockResolvedValueOnce(input);
    fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
    await waitFor(() => expect(external.setMasterGainValue).toHaveBeenCalledWith(input === '0 dB' ? 1 : 0));
}

function expectCommitted(project: { read: () => RawProject }, percent: number, entries: number): void {
    act(() => flushAutomergeStorageWrites());
    expect(project.read().transport.masterGain).toBeCloseTo(percent);
    expect(transportStore.value?.masterGain).toBeCloseTo(percent);
    expect(screen.getByRole('slider', { name: 'Master gain' })).toHaveAttribute('aria-valuenow', String(percent / 100));
    expect(screen.getByText(`${formatGainDb(percent / 100)} dB`)).toHaveTextContent(
        `${formatGainDb(percent / 100)} dB`
    );
    expect(external.setMasterGainValue).toHaveBeenLastCalledWith(percent / 100);
    expect(undoHistoryStore.value?.past).toHaveLength(entries);
    expect(project.read().actionHistory.entries).toHaveLength(entries);
}

describe('MasterChannelStrip queued typed value guard', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.spyOn(logger, 'error');
        injectDependencies(notifyUser, { eventBus: { emit: external.notification, on: () => () => undefined } });
        configureAutomergeStoragePort(null);
        resetAutomergeStorageProjections('root');
        clearHandlerRegistry();
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, masterGain: 80 });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        expect(logger.error).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it.each(['-61 dB', '-120 dB'])('rejects %s before dispatch, history or engine changes', async (input) => {
        const project = installProjectPort(() => Promise.resolve());
        render(<MasterChannelStrip widthClass="w-36" />);
        external.promptUser.mockResolvedValueOnce(input);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
        await waitFor(() =>
            expect(external.notification).toHaveBeenCalledWith('ui.notify', expect.objectContaining({ level: 'error' }))
        );
        act(() => flushAutomergeStorageWrites());
        expect(project.read().transport.masterGain).toBe(80);
        expect(transportStore.value?.masterGain).toBe(80);
        expect(screen.getByRole('slider', { name: 'Master gain' })).toHaveAttribute('aria-valuenow', '0.8');
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(project.read().actionHistory.entries).toHaveLength(0);
        expect(external.setMasterGainValue).not.toHaveBeenCalled();
    });

    it.each([
        { input: '-60 dB', gain: dbToGain(-60) },
        { input: '+6 dB', gain: dbToGain(6) },
        { input: '-inf', gain: 0 },
    ])('commits admitted boundary $input through the shared authority', async ({ input, gain }) => {
        const project = installProjectPort(() => Promise.resolve());
        render(<MasterChannelStrip widthClass="w-36" />);
        external.promptUser.mockResolvedValueOnce(input);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
        await waitFor(() => expect(project.read().transport.masterGain).toBe(gain * 100));
        expectCommitted(project, gain * 100, 1);
        expect(external.notification).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'anchors entry before the queue wait while accepting already present gain (foreignBeforeEntry=%s)',
        async (foreignBeforeEntry) => {
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            let waits = 0;
            const project = installProjectPort(() => {
                if (++waits === 1) {
                    entered.resolve();
                    return release.promise;
                }
                return Promise.resolve();
            });
            const errors = vi.spyOn(logger, 'error');
            const authority = captureProjectTransitionAuthority();
            render(<MasterChannelStrip widthClass="w-36" />);
            const slider = screen.getByRole('slider', { name: 'Master gain' });
            await act(async () => {
                fireEvent.keyDown(slider, { key: 'ArrowUp' });
                await entered.promise;
            });
            if (foreignBeforeEntry) {
                await act(async () => {
                    await executeAppAction({ type: 'setMasterGain', payload: { gain: 0.4, expectedPercent: 80 } });
                });
            }
            await typeEntry();
            if (!foreignBeforeEntry) {
                await act(async () => {
                    await executeAppAction({ type: 'setMasterGain', payload: { gain: 0.4, expectedPercent: 80 } });
                });
            }
            expect(authority.isCurrent()).toBe(true);
            await act(async () => {
                release.resolve();
                await release.promise;
            });
            const expected = foreignBeforeEntry ? 100 : 40;
            await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', String(expected / 100)));
            expectCommitted(project, expected, foreignBeforeEntry ? 2 : 1);
            expect(errors).not.toHaveBeenCalled();
        }
    );

    it('advances entry only over its captured successful own predecessors and preserves separate Undo/Redo', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        await act(async () => {
            fireEvent.keyDown(slider, { key: 'ArrowUp' });
            await entered.promise;
        });
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        await typeEntry();
        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(project.read().transport.masterGain).toBe(100));
        expectCommitted(project, 100, 3);
        await act(async () => {
            await undo();
        });
        expect(project.read().transport.masterGain).toBeCloseTo(82);
        expect(transportStore.value?.masterGain).toBeCloseTo(82);
        expect(external.setMasterGainValue).toHaveBeenLastCalledWith(0.82);
        await act(async () => {
            await redo();
        });
        expectCommitted(project, 100, 3);
    });

    it('keeps the accepted value guard through the real Command snapshot wait', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const errors = vi.spyOn(logger, 'error');
        render(<MasterChannelStrip widthClass="w-36" />);
        await typeEntry();
        await entered.promise;
        await act(async () => {
            await executeAppAction({ type: 'setMasterGain', payload: { gain: 0.4, expectedPercent: 80 } });
        });
        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() =>
            expect(screen.getByRole('slider', { name: 'Master gain' })).toHaveAttribute('aria-valuenow', '0.4')
        );
        expectCommitted(project, 40, 1);
        expect(errors).not.toHaveBeenCalled();
    });
});

describe('MasterChannelStrip gain clipboard admission', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.spyOn(logger, 'error');
        injectDependencies(notifyUser, { eventBus: { emit: external.notification, on: () => () => undefined } });
        configureAutomergeStoragePort(null);
        resetAutomergeStorageProjections('root');
        clearHandlerRegistry();
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, masterGain: 80 });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        expect(logger.error).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it.each([0, 1e-7, 0.8123456789])('commits exact canonical gain %s through Command and replays it', async (gain) => {
        const project = installProjectPort(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn(() => Promise.resolve(`gain:${String(gain)}`)) },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        external.setMasterGainValue.mockClear();
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));

        await waitFor(() => expect(project.read().transport.masterGain).toBe(gain * 100));
        expectCommitted(project, gain * 100, 1);
        expect(slider).toHaveAttribute('aria-valuenow', String(gain));
        await act(async () => {
            await undo();
        });
        expect(project.read().transport.masterGain).toBe(80);
        expect(transportStore.value?.masterGain).toBe(80);
        expect(external.setMasterGainValue).toHaveBeenLastCalledWith(0.8);
        await act(async () => {
            await redo();
        });
        expectCommitted(project, gain * 100, 1);
    });

    it('copies exact stored master percent divided by one hundred, including a sub-floor value', async () => {
        const masterGainPercent = 0.00001;
        const project = installProjectPort(() => Promise.resolve(), masterGainPercent);
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        external.setMasterGainValue.mockClear();
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(`gain:${String(masterGainPercent / 100)}`));
        expect(project.read().transport.masterGain).toBe(masterGainPercent);
        expect(transportStore.value?.masterGain).toBe(masterGainPercent);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(external.setMasterGainValue).not.toHaveBeenCalled();
    });

    it('copies the accepted settled gain after its held Command snapshot wait', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        external.setMasterGainValue.mockClear();

        await act(async () => {
            fireEvent.keyDown(slider, { key: 'ArrowUp' });
            await entered.promise;
        });
        expect(project.read().transport.masterGain).toBe(80);
        expect(transportStore.value?.masterGain).toBe(80);
        expect(slider).toHaveAttribute('aria-valuenow', '0.81');
        expect(external.setMasterGainValue).toHaveBeenLastCalledWith(0.81);

        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        expect(writeText).not.toHaveBeenCalled();

        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('gain:0.81'));
        expect(project.read().transport.masterGain).toBeCloseTo(81);
        expect(transportStore.value?.masterGain).toBeCloseTo(81);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(external.setMasterGainValue).toHaveBeenLastCalledWith(0.81);
    });

    it('copies an accepted paste only after its queued Command commits', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: () => Promise.resolve('gain:0.25'), writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });

        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        await act(async () => entered.promise);
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        expect(writeText).not.toHaveBeenCalled();

        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('gain:0.25'));
        expect(project.read().transport.masterGain).toBe(25);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    it('copies a menu-enter gain only after its queued Command commits', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        await typeEntry();
        await entered.promise;
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        expect(writeText).not.toHaveBeenCalled();

        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('gain:1'));
        expect(project.read().transport.masterGain).toBe(100);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    it('drops a queued copy after project replacement', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        await typeEntry();
        await entered.promise;
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        expect(writeText).not.toHaveBeenCalled();
        await act(async () => activateProject());
        await act(async () => {
            release.resolve();
            await release.promise;
        });
        expect(writeText).not.toHaveBeenCalled();
        expect(project.read().transport.masterGain).toBe(80);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
    });

    it('does not copy a rejected predecessor target', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        external.setMasterGainValue.mockClear();
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        await entered.promise;
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        expect(writeText).not.toHaveBeenCalled();

        await act(async () => {
            await executeAppAction({ type: 'setMasterGain', payload: { gain: 0.4, expectedPercent: 80 } });
        });
        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('gain:0.4'));
        expect(writeText).not.toHaveBeenCalledWith('gain:0.81');
        expect(project.read().transport.masterGain).toBe(40);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    it('drops a queued copy after a newer settled gain intent', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        await entered.promise;
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(project.read().transport.masterGain).toBeCloseTo(82));
        expect(writeText).not.toHaveBeenCalled();
    });

    it.each(['pan:0.25', 'gain:01', 'gain:1e0', 'gain:NaN', 'gain:Infinity', 'gain:2'])(
        'refuses noncanonical clipboard text %s without a write or preview',
        async (text) => {
            const project = installProjectPort(() => Promise.resolve());
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: vi.fn(() => Promise.resolve(text)) },
            });
            render(<MasterChannelStrip widthClass="w-36" />);
            const slider = screen.getByRole('slider', { name: 'Master gain' });
            external.setMasterGainValue.mockClear();
            fireEvent.contextMenu(slider);
            fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));

            await waitFor(() =>
                expect(external.notification).toHaveBeenCalledWith(
                    'ui.notify',
                    expect.objectContaining({
                        level: 'error',
                        message: 'Clipboard does not contain a valid master gain value.',
                    })
                )
            );
            expect(project.read().transport.masterGain).toBe(80);
            expect(transportStore.value?.masterGain).toBe(80);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            expect(project.read().actionHistory.entries).toHaveLength(0);
            expect(external.setMasterGainValue).not.toHaveBeenCalled();
            expect(slider).toHaveAttribute('aria-valuenow', '0.8');
        }
    );

    it('does not preview while a held clipboard read is pending', async () => {
        const project = installProjectPort(() => Promise.resolve());
        const read = Promise.withResolvers<string>();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: () => read.promise },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        external.setMasterGainValue.mockClear();
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        expect(project.read().transport.masterGain).toBe(80);
        expect(transportStore.value?.masterGain).toBe(80);
        expect(external.setMasterGainValue).not.toHaveBeenCalled();
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        await act(async () => {
            read.resolve('gain:0.25');
            await read.promise;
        });
        await waitFor(() => expect(project.read().transport.masterGain).toBe(25));
        expect(external.setMasterGainValue).toHaveBeenLastCalledWith(0.25);
    });

    it('keeps a held fader drag ahead of a pending clipboard read', async () => {
        const project = installProjectPort(() => Promise.resolve());
        const read = Promise.withResolvers<string>();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: () => read.promise },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        const cap = slider.querySelector('[data-role="fader-cap"]');
        expect(cap).not.toBeNull();
        external.setMasterGainValue.mockClear();

        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        fireEvent.pointerDown(cap!, { button: 0, pointerId: 8, clientY: 50 });
        fireEvent.pointerMove(slider, { pointerId: 8, clientY: 47 });
        const draggedValue = Number(slider.getAttribute('aria-valuenow'));
        expect(draggedValue).toBeGreaterThan(0.8);
        expect(draggedValue).toBeLessThan(1);
        expect(external.setMasterGainValue).toHaveBeenLastCalledWith(draggedValue);
        expect(project.read().transport.masterGain).toBe(80);
        expect(undoHistoryStore.value?.past).toHaveLength(0);

        await act(async () => {
            read.resolve('gain:0.25');
            await read.promise;
        });
        const projectGainAfterRead = project.read().transport.masterGain;
        const storeGainAfterRead = transportStore.value?.masterGain;
        const historyLengthAfterRead = undoHistoryStore.value?.past.length;
        const actionHistoryLengthAfterRead = project.read().actionHistory.entries.length;
        const displayedGainAfterRead = slider.getAttribute('aria-valuenow');
        const engineGainAfterRead = external.setMasterGainValue.mock.lastCall?.[0];
        await act(async () => {
            fireEvent.pointerUp(slider, { pointerId: 8 });
        });
        expect(projectGainAfterRead).toBe(80);
        expect(storeGainAfterRead).toBe(80);
        expect(historyLengthAfterRead).toBe(0);
        expect(actionHistoryLengthAfterRead).toBe(0);
        expect(displayedGainAfterRead).toBe(String(draggedValue));
        expect(engineGainAfterRead).toBe(draggedValue);
    });

    it('advances a paste CAS over its own committed queue predecessor', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let waits = 0;
        const project = installProjectPort(() => {
            if (++waits === 1) {
                entered.resolve();
                return release.promise;
            }
            return Promise.resolve();
        });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: () => Promise.resolve('gain:0.25') },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        await act(async () => {
            fireEvent.keyDown(slider, { key: 'ArrowUp' });
            await entered.promise;
        });
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        await act(async () => {
            release.resolve();
            await release.promise;
        });
        await waitFor(() => expect(project.read().transport.masterGain).toBe(25));
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        await act(async () => {
            await undo();
        });
        expect(project.read().transport.masterGain).toBeCloseTo(81);
        await act(async () => {
            await redo();
        });
        expect(project.read().transport.masterGain).toBe(25);
    });

    it('drops a clipboard read after a newer fader intent', async () => {
        const project = installProjectPort(() => Promise.resolve());
        const read = Promise.withResolvers<string>();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: () => read.promise },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        await act(async () => {
            read.resolve('gain:0.25');
            await read.promise;
        });
        await waitFor(() => expect(project.read().transport.masterGain).not.toBe(25));
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(transportStore.value?.masterGain).not.toBe(25);
    });

    it('drops a clipboard read after equal-value project replacement', async () => {
        const project = installProjectPort(() => Promise.resolve());
        const read = Promise.withResolvers<string>();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: () => read.promise },
        });
        render(<MasterChannelStrip widthClass="w-36" />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        await act(async () => {
            await activateProject();
        });
        await act(async () => {
            read.resolve('gain:0.25');
            await read.promise;
        });
        expect(project.read().transport.masterGain).toBe(80);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(external.setMasterGainValue).not.toHaveBeenCalledWith(0.25);
    });
});
