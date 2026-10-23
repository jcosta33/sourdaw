import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, fireEvent, within, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    createAppActionCommittedError,
    executeUserAppAction,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { CommandPalette } from '#/modules/CommandInterface/presentations/views';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { ArrangementSelector } from '#/modules/Project/presentations/views';
import { arrangementStore } from '#/modules/Project/stores';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore, trackStore, type Track } from '../../../stores';
import { getArrangementHandlers } from '../../../useCases';
import { addClip } from '../../../useCases/clip/addClip';
import { bounceTrack } from '../../../useCases/freezeBounce/bounceTrack';
import { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import { importAudioClipToTrack } from '../../../useCases/importAudioClipToTrack';
import { importMidiFile } from '../../../useCases/importMidiFile';
import { removeTrack } from '../../../useCases/removeTrack';
import { saveTrackAsTemplate } from '../../../useCases/saveTrackAsTemplate';
import { setInputMonitoring } from '../../../useCases/setTrackGainPan/setInputMonitoring';
import { toggleVariationLanes } from '../../../useCases/toggleTrackState/toggleVariationLanes';
import { useTracks } from '../../hooks/useTracks';
import { TrackContextMenu } from '../TrackContextMenu';

import type { actionHistoryStore } from '#/modules/CrdtDocument/stores';

// Mock external dependencies
vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: vi.fn(),
}));

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/toggleVariationLanes', () => ({
    toggleVariationLanes: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/bounceTrack', () => ({
    bounceTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

vi.mock('../../../useCases/importAudioClipToTrack', () => ({
    importAudioClipToTrack: vi.fn(),
}));

vi.mock('../../../useCases/saveTrackAsTemplate', () => ({
    saveTrackAsTemplate: vi.fn(),
}));

vi.mock('../../../useCases/setTrackGainPan/setInputMonitoring', () => ({
    setInputMonitoring: vi.fn(),
}));

vi.mock('../../../useCases/importMidiFile', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [],
        selectedTrackId: null,
    })),
}));

const projectEpoch = vi.hoisted(() => {
    let epoch = 0;
    let latest: { isCurrent: () => boolean } | null = null;
    const makeAuthority = () => {
        const capturedEpoch = epoch;
        return { isCurrent: () => epoch === capturedEpoch };
    };
    return {
        advance: () => {
            epoch += 1;
        },
        capture: vi.fn(() => {
            latest = makeAuthority();
            return latest;
        }),
        currentAuthority: makeAuthority,
        latest: () => latest,
        reset: () => {
            epoch = 0;
            latest = null;
        },
    };
});

const mockTrack = TrackDummy.create({
    id: 'track1',
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    freezeState: { status: 'unfrozen' },
    soloSafe: false,
    color: '#ff0000',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 64,
});

const frozenTrack = TrackDummy.create({
    id: 'fz2',
    frozen: true,
    freezeState: { status: 'frozen', freezeId: 'take-1', frozenBufferId: 'buffer-1', renderedAt: 123 },
});

const openFrozenMenu = (track = frozenTrack) => {
    renderWithTooltip(
        <TrackContextMenu track={track}>
            <div data-testid="track">Frozen</div>
        </TrackContextMenu>
    );
    fireEvent.contextMenu(screen.getByTestId('track'));
    fireEvent.click(screen.getByText('Flatten Track'));
};

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectEpoch.reset();
        arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'arr-A' });
        vi.mocked(useTracks).mockReturnValue({ tracks: [mockTrack], selectedTrackId: mockTrack.id });
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div>Track Content</div>
            </TrackContextMenu>
        );
        expect(screen.getByText('Track Content')).toBeInTheDocument();
    });

    it('should render context menu on right click', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render Add Clip menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Add Clip')).toBeInTheDocument();
    });

    it('should render Import menu items', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Import Audio...')).toBeInTheDocument();
        expect(screen.getByText('Import MIDI...')).toBeInTheDocument();
    });

    it('should render Arm for Recording menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Arm for Recording')).toBeInTheDocument();
    });

    it('should render Freeze menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Freeze')).toBeInTheDocument();
    });

    it('should render Bounce menu items', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Bounce...')).toBeInTheDocument();
    });

    it('should submit the default bounce options for the current track', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div>Track Content</div>
            </TrackContextMenu>
        );

        fireEvent.contextMenu(screen.getByText('Track Content'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Bounce...' }));

        const dialog = screen.getByRole('dialog', { name: 'Bounce Test Track' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Render' }));

        expect(vi.mocked(bounceTrack)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(bounceTrack)).toHaveBeenCalledWith('track1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'new-track',
        });
    });

    it('should render Delete Track menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Delete Track')).toBeInTheDocument();
    });

    it('should show color picker when Track Color is clicked', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        const colorButton = screen.getByText('Track Color...');
        fireEvent.click(colorButton);
        expect(screen.getByText('Track Color')).toBeInTheDocument();
    });

    it('should show input monitoring options for audio/midi tracks', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText(/Input Monitor:/)).toBeInTheDocument();
    });

    it('should save the current track as a template', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);

        fireEvent.click(screen.getByText('Save as Template'));

        expect(vi.mocked(saveTrackAsTemplate)).toHaveBeenCalledWith('track1', 'Test Track');
    });

    it('adds a midi clip through the registered addClip action when the track kind is midi', () => {
        const midiTrack = TrackDummy.create({ id: 'midi1', kind: 'midi' });
        renderWithTooltip(
            <TrackContextMenu track={midiTrack}>
                <div data-testid="track">MIDI</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Add Clip'));
        // The undoable `addClip` action, not the bare use case: the use case
        // captures no inverse, so a menu-created clip left no history
        // (issue #3696). `addClipUndo.integration.spec.tsx` asserts the
        // resulting undo/redo end-to-end.
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'addClip',
            payload: expect.objectContaining({
                trackId: 'midi1',
                startBeat: 0,
                endBeat: 16,
                name: expect.stringMatching(/^Clip \d+$/),
                type: 'midi',
            }),
        });
        expect(vi.mocked(addClip)).not.toHaveBeenCalled();
    });

    it('adds an audio clip through the registered addClip action when the track kind is audio', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Add Clip'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'addClip',
            payload: expect.objectContaining({
                trackId: 'track1',
                startBeat: 0,
                endBeat: 16,
                name: expect.stringMatching(/^Clip \d+$/),
                type: 'audio',
            }),
        });
        expect(vi.mocked(addClip)).not.toHaveBeenCalled();
    });

    it('unfreezes a frozen track and offers Flatten Track', () => {
        const frozenTrack = TrackDummy.create({
            id: 'fz1',
            frozen: true,
            freezeState: { status: 'frozen' },
        });
        renderWithTooltip(
            <TrackContextMenu track={frozenTrack}>
                <div data-testid="track">Frozen</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        // Frozen → label is "Unfreeze".
        fireEvent.click(screen.getByText('Unfreeze'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'unfreezeTrack',
            payload: { trackId: 'fz1' },
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('shows Update Freeze label when the freeze state is stale', () => {
        const staleTrack = TrackDummy.create({
            id: 'stale1',
            frozen: true,
            freezeState: { status: 'stale' },
        });
        renderWithTooltip(
            <TrackContextMenu track={staleTrack}>
                <div data-testid="track">Stale</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        expect(screen.getByText('Update Freeze')).toBeInTheDocument();
    });

    it('waits for confirmation before flattening a frozen track', () => {
        vi.mocked(confirmUser).mockReturnValue(new Promise<boolean>(() => {}));
        openFrozenMenu();
        const confirmation: unknown = vi.mocked(confirmUser).mock.calls[0]?.[0];
        expect(confirmation).toMatchObject({ confirmLabel: 'Flatten' });
        if (!confirmation || typeof confirmation !== 'object') {
            throw new Error('Flatten confirmation options were not supplied');
        }
        expect('message' in confirmation ? confirmation.message : undefined).toMatch(/clips.*devices/i);
        expect(vi.mocked(executeUserAppAction)).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('leaves the frozen take untouched when Flatten is cancelled or dismissed', async () => {
        let resolveConfirm!: (value: boolean) => void;
        const confirmationPending = new Promise<boolean>((resolve) => (resolveConfirm = resolve));
        vi.mocked(confirmUser).mockReturnValue(confirmationPending);
        openFrozenMenu();
        await act(async () => {
            resolveConfirm(false);
            await confirmationPending;
        });
        expect(vi.mocked(executeUserAppAction)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it('admits the same frozen take and a legacy take without optional ids', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [frozenTrack], selectedTrackId: frozenTrack.id });
        openFrozenMenu();
        await vi.waitFor(() => expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1));
        const [action, options] = vi.mocked(executeUserAppAction).mock.calls[0]!;
        expect(action).toEqual({ type: 'flattenTrack', payload: { trackId: 'fz2' } });
        expect(options?.shouldExecute?.()).toBe(true);

        cleanup();
        vi.mocked(executeUserAppAction).mockClear();
        const legacy = TrackDummy.create({
            ...frozenTrack,
            id: 'legacy',
            freezeState: { status: 'frozen', frozenBufferId: 'legacy-buffer' },
        });
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [legacy], selectedTrackId: legacy.id });
        openFrozenMenu(legacy);
        await vi.waitFor(() => expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1));
        expect(vi.mocked(executeUserAppAction).mock.calls[0]?.[1]?.shouldExecute?.()).toBe(true);
    });

    it.each([
        ['track removed', () => null],
        ['unfrozen', () => ({ frozen: false })],
        ['stale freeze', () => ({ freezeState: { ...frozenTrack.freezeState, status: 'stale' as const } })],
        ['error freeze', () => ({ freezeState: { ...frozenTrack.freezeState, status: 'error' as const } })],
        ['different buffer', () => ({ freezeState: { ...frozenTrack.freezeState, frozenBufferId: 'buffer-2' } })],
        ['different freeze id', () => ({ freezeState: { ...frozenTrack.freezeState, freezeId: 'take-2' } })],
        ['different render time', () => ({ freezeState: { ...frozenTrack.freezeState, renderedAt: 124 } })],
    ])('declines a queued Flatten after %s', async (_name, change) => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        let resolveAction!: () => void;
        const actionPending = new Promise<void>((resolve) => {
            resolveAction = resolve;
        });
        vi.mocked(executeUserAppAction).mockReturnValue(actionPending);
        let current = frozenTrack;
        vi.mocked(getTrackStoreState).mockImplementation(() => ({ tracks: [current], selectedTrackId: current.id }));
        openFrozenMenu();
        await vi.waitFor(() => expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1));
        const shouldExecute = vi.mocked(executeUserAppAction).mock.calls[0]?.[1]?.shouldExecute;
        expect(shouldExecute?.()).toBe(true);
        const changed = change();
        current =
            changed === null ? TrackDummy.create({ id: 'other' }) : TrackDummy.create({ ...frozenTrack, ...changed });
        expect(shouldExecute?.()).toBe(false);
        await act(async () => {
            resolveAction();
            await actionPending;
        });
        expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[0]).toMatch(/changed.*cancelled/i);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
    });

    it('declines after a project transition while confirmation is pending', async () => {
        let resolveConfirm!: (value: boolean) => void;
        const confirmationPending = new Promise<boolean>((resolve) => (resolveConfirm = resolve));
        vi.mocked(confirmUser).mockReturnValue(confirmationPending);
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [frozenTrack], selectedTrackId: frozenTrack.id });
        vi.mocked(executeUserAppAction).mockImplementation((_action, options) => {
            options?.shouldExecute?.();
            return Promise.resolve();
        });
        openFrozenMenu();
        projectEpoch.advance();
        await act(async () => {
            resolveConfirm(true);
            await confirmationPending;
        });
        const shouldExecute = vi.mocked(executeUserAppAction).mock.calls[0]?.[1]?.shouldExecute;
        expect(shouldExecute?.()).toBe(false);
        expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    });

    it('declines a project transition while the confirmed command is queued', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [frozenTrack], selectedTrackId: frozenTrack.id });
        let resolveAction!: () => void;
        const actionPending = new Promise<void>((resolve) => {
            resolveAction = resolve;
        });
        vi.mocked(executeUserAppAction).mockReturnValue(actionPending);
        openFrozenMenu();
        await vi.waitFor(() => expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1));
        projectEpoch.advance();
        expect(vi.mocked(executeUserAppAction).mock.calls[0]?.[1]?.shouldExecute?.()).toBe(false);
        await act(async () => {
            resolveAction();
            await actionPending;
        });
        expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    });

    it.each(['dialog', 'queue'] as const)(
        'declines a changed arrangement after %s without dispatching the old Flatten',
        async (stage) => {
            const confirmation = Promise.withResolvers<boolean>();
            vi.mocked(confirmUser).mockReturnValue(confirmation.promise);
            const command = Promise.withResolvers<void>();
            vi.mocked(executeUserAppAction).mockImplementation((_action, options) => {
                if (stage === 'dialog') {
                    options?.shouldExecute?.();
                    return Promise.resolve();
                }
                return command.promise;
            });
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [frozenTrack], selectedTrackId: frozenTrack.id });
            const original = structuredClone(frozenTrack);
            openFrozenMenu();
            if (stage === 'dialog') {
                arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'arr-B' });
            }
            await act(async () => {
                confirmation.resolve(true);
                await confirmation.promise;
            });
            const shouldExecute = vi.mocked(executeUserAppAction).mock.calls[0]?.[1]?.shouldExecute;
            expect(shouldExecute).toBeDefined();
            if (stage === 'queue') {
                arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'arr-B' });
                expect(shouldExecute?.()).toBe(false);
                await act(async () => {
                    command.resolve();
                    await command.promise;
                });
            }
            expect(frozenTrack).toEqual(original);
            expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(
                'The frozen track changed. Flatten was cancelled; check the track and try again.',
                'warning'
            );
        }
    );

    it.each([
        ['storage refusal', new Error('storage refused')],
        [
            'committed failure',
            createAppActionCommittedError({ actionType: 'flattenTrack', cause: new Error('receipt') }),
        ],
    ])('shows one failure notice for a %s without retrying Flatten', async (_kind, error) => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [frozenTrack], selectedTrackId: frozenTrack.id });
        vi.mocked(executeUserAppAction).mockRejectedValue(error);
        const original = structuredClone(frozenTrack);
        openFrozenMenu();
        await vi.waitFor(() =>
            expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(
                'Flatten could not finish. Check the track before trying again.',
                'error'
            )
        );
        expect(frozenTrack).toEqual(original);
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    });

    it('does not offer a destructive confirmation for a frozen track without a buffer', () => {
        openFrozenMenu(TrackDummy.create({ ...frozenTrack, freezeState: { status: 'frozen' } }));
        expect(vi.mocked(confirmUser)).not.toHaveBeenCalled();
        expect(vi.mocked(executeUserAppAction)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(expect.stringMatching(/unavailable/i), 'warning');
    });

    it('deletes the track after confirming', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Delete Track'));
        // confirmUser is awaited inside an async IIFE. The delete goes through
        // the undoable `removeTrack` action, not the bare use case: the use
        // case captures no inverse, so the menu's delete was unrecoverable
        // (audit M-015). `trackDeleteUndo.integration.spec.tsx` asserts the
        // resulting undo end-to-end.
        await vi.waitFor(() => {
            expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
                type: 'removeTrack',
                payload: { trackId: 'track1' },
            });
        });
        expect(vi.mocked(removeTrack)).not.toHaveBeenCalled();
    });

    it('does not delete the track when the confirm dialog is cancelled', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Delete Track'));
        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalled();
        });
        expect(vi.mocked(removeTrack)).not.toHaveBeenCalled();
        expect(vi.mocked(executeUserAppAction)).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'removeTrack' })
        );
    });

    it('commits a rename with the trimmed name', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Rename'));
        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: '  Renamed  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track1', name: 'Renamed' },
        });
    });

    it('does not rename when the submitted value is blank', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Rename'));
        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(executeUserAppAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'renameTrack' }));
    });

    it('applies the selected input monitoring value', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText(/Input Monitor:/));
        // Pick the "On" option (mockTrack defaults to 'auto').
        fireEvent.click(screen.getByRole('menuitem', { name: 'On' }));
        expect(vi.mocked(setInputMonitoring)).toHaveBeenCalledWith('track1', 'on');
    });

    it('keeps a forwarded audio continuation bound to its picker epoch', async () => {
        let resolveImport!: (outcome: 'completed' | 'superseded') => void;
        vi.mocked(importAudioClipToTrack).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveImport = resolve;
            })
        );
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import Audio...'));
        const fileInputs = Array.from(document.querySelectorAll('input[type=file]')) as HTMLInputElement[];
        const audioInput = fileInputs.find((i) => i.accept === 'audio/*')!;
        const file = new File(['data'], 'clip.wav', { type: 'audio/wav' });
        Object.defineProperty(audioInput, 'files', { value: [file], configurable: true });
        fireEvent.change(audioInput);
        await vi.waitFor(() => {
            expect(vi.mocked(importAudioClipToTrack)).toHaveBeenCalledWith('track1', file, {
                shouldContinue: expect.any(Function),
            });
        });
        const originalOptions = vi.mocked(importAudioClipToTrack).mock.calls[0]?.[2];
        expect(originalOptions?.shouldContinue()).toBe(true);

        projectEpoch.advance();
        expect(originalOptions?.shouldContinue()).toBe(false);
        resolveImport('superseded');
        await Promise.resolve();

        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import Audio...'));
        const successorFile = new File(['data'], 'successor.wav', { type: 'audio/wav' });
        Object.defineProperty(audioInput, 'files', { value: [successorFile], configurable: true });
        fireEvent.change(audioInput);

        await vi.waitFor(() => expect(importAudioClipToTrack).toHaveBeenCalledTimes(2));
        const successorOptions = vi.mocked(importAudioClipToTrack).mock.calls[1]?.[2];
        expect(successorOptions?.shouldContinue()).toBe(true);
    });

    it('keeps a forwarded MIDI continuation bound to its picker epoch', async () => {
        let resolveImport!: (outcome: 'completed' | 'superseded') => void;
        vi.mocked(importMidiFile).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveImport = resolve;
            })
        );
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import MIDI...'));
        const fileInputs = Array.from(document.querySelectorAll('input[type=file]')) as HTMLInputElement[];
        const midiInput = fileInputs.find((i) => i.accept.includes('.mid'))!;
        const file = new File(['data'], 'song.mid', { type: 'audio/midi' });
        Object.defineProperty(midiInput, 'files', { value: [file], configurable: true });
        fireEvent.change(midiInput);
        await vi.waitFor(() => {
            expect(vi.mocked(importMidiFile)).toHaveBeenCalledWith(file, { shouldContinue: expect.any(Function) });
        });
        const originalOptions = vi.mocked(importMidiFile).mock.calls[0]?.[1];
        expect(originalOptions?.shouldContinue()).toBe(true);

        projectEpoch.advance();
        expect(originalOptions?.shouldContinue()).toBe(false);
        resolveImport('superseded');

        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import MIDI...'));
        const successorFile = new File(['data'], 'successor.mid', { type: 'audio/midi' });
        Object.defineProperty(midiInput, 'files', { value: [successorFile], configurable: true });
        fireEvent.change(midiInput);

        await vi.waitFor(() => expect(importMidiFile).toHaveBeenCalledTimes(2));
        const successorOptions = vi.mocked(importMidiFile).mock.calls[1]?.[1];
        expect(successorOptions?.shouldContinue()).toBe(true);
    });

    it('keeps a stale picker out of the successor track while a new picker remains current', async () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import Audio...'));
        projectEpoch.advance();
        expect(projectEpoch.latest()?.isCurrent()).toBe(false);
        expect(projectEpoch.currentAuthority().isCurrent()).toBe(true);
        const audioInput = Array.from(document.querySelectorAll('input[type=file]')).find(
            (input) => (input as HTMLInputElement).accept === 'audio/*'
        ) as HTMLInputElement;
        Object.defineProperty(audioInput, 'files', {
            value: [new File(['data'], 'stale.wav', { type: 'audio/wav' })],
            configurable: true,
        });

        fireEvent.change(audioInput);

        expect(importAudioClipToTrack).not.toHaveBeenCalled();

        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import Audio...'));
        const successorFile = new File(['data'], 'successor.wav', { type: 'audio/wav' });
        Object.defineProperty(audioInput, 'files', { value: [successorFile], configurable: true });
        fireEvent.change(audioInput);

        await vi.waitFor(() => {
            expect(importAudioClipToTrack).toHaveBeenCalledWith('track1', successorFile, {
                shouldContinue: expect.any(Function),
            });
        });
        expect(captureProjectTransitionAuthority).toHaveBeenCalledTimes(2);
    });

    it('applies a color from the color picker', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Track Color...'));
        const swatches = screen.getAllByRole('button', { name: 'Set color' });
        fireEvent.click(swatches[0]!);
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'setTrackColor',
            payload: { trackId: 'track1', color: expect.any(String) },
        });
    });

    it('routes disarming through the canonical AppAction write path', () => {
        const armedTrack = TrackDummy.create({ id: 'arm1', armed: true });
        renderWithTooltip(
            <TrackContextMenu track={armedTrack}>
                <div data-testid="track">Armed</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Disarm'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 'arm1', armed: false },
        });
    });

    it('freezes an unfrozen track', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Freeze'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'freezeTrack',
            payload: { trackId: 'track1' },
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('duplicates the track', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Duplicate Track'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'duplicateTrack',
            payload: { trackId: 'track1' },
        });
    });

    it('preserves showVariationLanes as false when committing track rename via Enter', () => {
        const track = TrackDummy.create({
            id: 'track1',
            name: 'Test Track',
            showVariationLanes: false,
        });
        const onUnexpectedAction = vi.fn();
        renderWithTooltip(
            <div onKeyDown={onUnexpectedAction}>
                <TrackContextMenu track={track}>
                    <button
                        type="button"
                        aria-label="Toggle variation lanes"
                        onClick={() => toggleVariationLanes(track.id)}
                    >
                        Toggle variation lanes
                    </button>
                </TrackContextMenu>
            </div>
        );

        const toggleBtn = screen.getByLabelText('Toggle variation lanes');
        toggleBtn.focus();
        fireEvent.contextMenu(toggleBtn);
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: 'Renamed Track' } });

        const enterEvent = createEvent.keyDown(input, { key: 'Enter', cancelable: true });
        fireEvent(input, enterEvent);

        expect(enterEvent.defaultPrevented).toBe(true);
        expect(onUnexpectedAction).not.toHaveBeenCalled();
        expect(toggleVariationLanes).not.toHaveBeenCalled();
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track1', name: 'Renamed Track' },
        });
        expect(track.showVariationLanes).toBe(false);
    });

    it('preserves showVariationLanes as false when cancelling track rename via Escape', () => {
        const track = TrackDummy.create({
            id: 'track1',
            name: 'Test Track',
            showVariationLanes: false,
        });
        const onUnexpectedAction = vi.fn();
        renderWithTooltip(
            <div onKeyDown={onUnexpectedAction}>
                <TrackContextMenu track={track}>
                    <button
                        type="button"
                        aria-label="Toggle variation lanes"
                        onClick={() => toggleVariationLanes(track.id)}
                    >
                        Toggle variation lanes
                    </button>
                </TrackContextMenu>
            </div>
        );

        const toggleBtn = screen.getByLabelText('Toggle variation lanes');
        toggleBtn.focus();
        fireEvent.contextMenu(toggleBtn);
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: 'Different Track' } });

        const escapeEvent = createEvent.keyDown(input, { key: 'Escape', cancelable: true });
        fireEvent(input, escapeEvent);

        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(onUnexpectedAction).not.toHaveBeenCalled();
        expect(toggleVariationLanes).not.toHaveBeenCalled();
        expect(executeUserAppAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'renameTrack' }));
        expect(track.showVariationLanes).toBe(false);
    });

    it('preserves showVariationLanes as true when committing track rename via Enter', () => {
        const track = TrackDummy.create({
            id: 'track1',
            name: 'Test Track',
            showVariationLanes: true,
        });
        const onUnexpectedAction = vi.fn();
        renderWithTooltip(
            <div onKeyDown={onUnexpectedAction}>
                <TrackContextMenu track={track}>
                    <button
                        type="button"
                        aria-label="Toggle variation lanes"
                        onClick={() => toggleVariationLanes(track.id)}
                    >
                        Toggle variation lanes
                    </button>
                </TrackContextMenu>
            </div>
        );

        const toggleBtn = screen.getByLabelText('Toggle variation lanes');
        toggleBtn.focus();
        fireEvent.contextMenu(toggleBtn);
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: 'Renamed Track Again' } });

        const enterEvent = createEvent.keyDown(input, { key: 'Enter', cancelable: true });
        fireEvent(input, enterEvent);

        expect(enterEvent.defaultPrevented).toBe(true);
        expect(onUnexpectedAction).not.toHaveBeenCalled();
        expect(toggleVariationLanes).not.toHaveBeenCalled();
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track1', name: 'Renamed Track Again' },
        });
        expect(track.showVariationLanes).toBe(true);
    });

    it('preserves showVariationLanes as true when cancelling track rename via Escape', () => {
        const track = TrackDummy.create({
            id: 'track1',
            name: 'Test Track',
            showVariationLanes: true,
        });
        const onUnexpectedAction = vi.fn();
        renderWithTooltip(
            <div onKeyDown={onUnexpectedAction}>
                <TrackContextMenu track={track}>
                    <button
                        type="button"
                        aria-label="Toggle variation lanes"
                        onClick={() => toggleVariationLanes(track.id)}
                    >
                        Toggle variation lanes
                    </button>
                </TrackContextMenu>
            </div>
        );

        const toggleBtn = screen.getByLabelText('Toggle variation lanes');
        toggleBtn.focus();
        fireEvent.contextMenu(toggleBtn);
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Test Track');
        const escapeEvent = createEvent.keyDown(input, { key: 'Escape', cancelable: true });
        fireEvent(input, escapeEvent);

        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(onUnexpectedAction).not.toHaveBeenCalled();
        expect(toggleVariationLanes).not.toHaveBeenCalled();
        expect(executeUserAppAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'renameTrack' }));
        expect(track.showVariationLanes).toBe(true);
    });

    it('should not render Clear All Solos menu item when no tracks are soloed', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.queryByText('Clear All Solos')).not.toBeInTheDocument();
    });

    it('should render Clear All Solos menu item and dispatch clearSolos on click when a track is soloed', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [{ ...mockTrack, soloed: true }],
            selectedTrackId: mockTrack.id,
        });
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Clear All Solos')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Clear All Solos'));
        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'clearSolos' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should render Disable Track when track is not disabled and dispatch disableTrack on click', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Disable Track')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Disable Track'));
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'disableTrack',
            payload: { trackId: 'track1', disabled: true },
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should render Enable Track when track is disabled and dispatch disableTrack on click', () => {
        const disabledTrack = { ...mockTrack, disabled: true };
        renderWithTooltip(
            <TrackContextMenu track={disabledTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Enable Track')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Enable Track'));
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'disableTrack',
            payload: { trackId: 'track1', disabled: false },
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('routes toggling solo safe through executeUserAppAction', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        fireEvent.click(screen.getByText('Solo Safe'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'toggleSoloSafe',
            payload: { trackId: 'track1' },
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});

describe('TrackContextMenu Flatten failure with canonical project truth', () => {
    type Root = {
        tracks: NonNullable<typeof trackStore.value>;
        takeLanes: NonNullable<typeof takeLaneStore.value>;
        actionHistory: NonNullable<typeof actionHistoryStore.value>;
    };

    const sourceClip: Track['clips'][number] = {
        id: 'clip-fz2',
        trackId: 'fz2',
        name: 'Editable MIDI',
        startBeat: 2,
        endBeat: 6,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 0.7,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
    const sourceTrack = TrackDummy.create({
        ...frozenTrack,
        kind: 'midi',
        clips: [sourceClip],
        alternatives: [{ id: 'alt-1', name: 'Original', clips: [sourceClip] }],
        devices: [{ id: 'device-original', name: 'Reverb', type: 'reverb', bypassed: false, parameterValues: {} }],
    });

    function readTruth(): Root {
        flushAutomergeStorageWrites();
        const root = getCrdtDoc<Root>('root');
        if (!root) {
            throw new Error('Expected the canonical CRDT root');
        }
        return structuredClone({ tracks: root.tracks, takeLanes: root.takeLanes, actionHistory: root.actionHistory });
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        projectEpoch.reset();
        arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'arr-A' });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({
            flattenTrack: handlers.flattenTrack,
            restoreTrackClipStates: handlers.restoreTrackClipStates,
        });
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearUndoHistory();
        clearActionHistory();
        trackStore.set({ tracks: [sourceTrack], selectedTrackId: sourceTrack.id });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-fz2',
                    trackId: sourceTrack.id,
                    takes: [
                        {
                            id: 'take-original',
                            clipId: sourceClip.id,
                            name: 'Original take',
                            startBeat: 2,
                            endBeat: 6,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: 'take-original' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        const samples = new Float32Array(128).fill(0.25);
        audioBufferCache.set('buffer-1', {
            duration: samples.length / 48_000,
            length: samples.length,
            numberOfChannels: 1,
            sampleRate: 48_000,
            getChannelData: () => samples,
            copyFromChannel: (destination, _channel, start = 0) => {
                destination.set(samples.subarray(start, start + destination.length));
            },
            copyToChannel: (source, _channel, start = 0) => {
                samples.set(source, start);
            },
        });
        vi.mocked(getTrackStoreState).mockImplementation(() => trackStore.value);
        vi.mocked(useTracks).mockReturnValue({ tracks: [sourceTrack], selectedTrackId: sourceTrack.id });
        vi.mocked(confirmUser).mockResolvedValue(true);
        const actual = await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
        vi.mocked(executeUserAppAction).mockImplementation(actual.executeUserAppAction);
    });

    afterEach(() => {
        cleanup();
        workspaceStore.set({ ...workspaceStore.value!, commandPaletteOpen: false });
        configureAutomergeStoragePort(null);
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('keeps raw clips, devices, takes, and history after a refused storage commit and shows one error', async () => {
        const original = readTruth();
        const originalStore = structuredClone(trackStore.value);
        const originalLanes = structuredClone(takeLaneStore.value);
        const refusal = new Error('Context Flatten storage refused');
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: () => {
                throw refusal;
            },
        });
        openFrozenMenu(sourceTrack);
        await vi.waitFor(() =>
            expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(
                'Flatten could not finish. Check the track before trying again.',
                'error'
            )
        );
        expect(readTruth()).toEqual(original);
        expect(trackStore.value).toEqual(originalStore);
        expect(takeLaneStore.value).toEqual(originalLanes);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    });

    it('reports a committed-classified failure once while retaining the committed result', async () => {
        const original = readTruth();
        const actual = await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
        vi.mocked(executeUserAppAction).mockImplementation(async (...args) => {
            await actual.executeUserAppAction(...args);
            throw createAppActionCommittedError({ actionType: 'flattenTrack', cause: new Error('receipt') });
        });
        openFrozenMenu(sourceTrack);
        await vi.waitFor(() =>
            expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(
                'Flatten could not finish. Check the track before trying again.',
                'error'
            )
        );
        const committed = readTruth();
        expect(committed).not.toEqual(original);
        expect(committed.tracks.tracks[0]).toMatchObject({ kind: 'audio', devices: [], frozen: false });
        expect(committed.takeLanes.lanes).toEqual([]);
        expect(committed.actionHistory.entries).toHaveLength(1);
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser)).toHaveBeenCalledTimes(1);
    });

    it('rejects a palette Flatten opened during a duplicate-arrangement switch held at audio preparation', async () => {
        const source = {
            id: 'arr-A',
            name: 'Arrangement A',
            tracks: structuredClone(trackStore.value!),
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            takeLanes: structuredClone(takeLaneStore.value!),
        };
        arrangementStore.set({
            activeArrangementId: source.id,
            arrangements: [source, { ...source, id: 'placeholder', name: 'Placeholder' }],
        });
        flushAutomergeStorageWrites();
        const prepared = vi.spyOn(audioBufferCache, 'prepareFromIdb').mockResolvedValue({
            cancel: () => undefined,
            publish: () => 0,
        });
        renderWithTooltip(
            <>
                <ArrangementSelector />
                <CommandPalette />
            </>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Arrangement selector' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Current' }));
        const successorId = arrangementStore.value!.activeArrangementId;
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === sourceTrack.id ? { ...track, name: 'B editable original' } : track
            ),
        });
        flushAutomergeStorageWrites();
        fireEvent.click(screen.getByRole('button', { name: 'Arrangement selector' }));
        fireEvent.click(screen.getByTitle('Arrangement A'));
        await vi.waitFor(() => expect(arrangementStore.value?.activeArrangementId).toBe(source.id));
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        prepared.mockImplementationOnce(async () => {
            entered.resolve();
            await release.promise;
            return { cancel: () => undefined, publish: () => 0 };
        });
        fireEvent.click(screen.getByTitle('Arrangement A (Copy)'));
        await entered.promise;
        const decision = Promise.withResolvers<boolean>();
        vi.mocked(confirmUser).mockReturnValue(decision.promise);
        await act(async () => {
            workspaceStore.set({ ...workspaceStore.value!, commandPaletteOpen: true });
        });
        fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'Flatten Track' } });
        fireEvent.click(screen.getByRole('option', { name: /Flatten Track/ }));
        expect(vi.mocked(confirmUser)).toHaveBeenCalledTimes(1);
        release.resolve();
        await vi.waitFor(() => expect(arrangementStore.value?.activeArrangementId).toBe(successorId));
        expect(projectEpoch.latest()?.isCurrent()).toBe(true);
        const successor = readTruth();
        expect(successor.tracks.tracks[0]).toMatchObject({
            id: sourceTrack.id,
            name: 'B editable original',
            frozen: true,
            devices: [{ id: 'device-original', name: 'Reverb' }],
            freezeState: { freezeId: 'take-1', frozenBufferId: 'buffer-1', renderedAt: 123 },
        });
        expect(successor.takeLanes.lanes[0]?.takes[0]).toMatchObject({ clipId: sourceClip.id });
        decision.resolve(true);
        await vi.waitFor(() =>
            expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(
                'The frozen track changed. Flatten was cancelled; check the track and try again.',
                'warning'
            )
        );
        expect(readTruth()).toEqual(successor);
        expect(trackStore.value?.tracks).toEqual(successor.tracks.tracks);
        expect(takeLaneStore.value).toEqual(successor.takeLanes);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledTimes(1);
    });
});
vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: projectEpoch.capture,
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));
