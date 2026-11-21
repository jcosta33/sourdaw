import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PianoRollContextMenu } from '../PianoRollContextMenu';

const mocks = vi.hoisted(() => ({
    writes: {
        removeMidiNote: vi.fn(),
        setNotesForClip: vi.fn(),
        strumNotes: vi.fn(),
        pasteNotes: vi.fn(),
        executeUserAppAction: vi.fn(),
        pushUndoEntry: vi.fn(),
    },
    copySelectedNotes: vi.fn(),
    notifyUser: vi.fn(),
    trackState: { tracks: [] as Array<{ id: string; frozen: boolean; clips: Array<{ id: string }> }> },
}));

vi.mock('#/components/daw/DawContextMenuSurface', () => ({
    DawContextMenuSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({
        children,
        onClick,
        disabled,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DawMenuSeparator: () => <hr />,
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({ useContextMenuDismiss: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    copySelectedNotes: mocks.copySelectedNotes,
    pasteNotes: mocks.writes.pasteNotes,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: mocks.writes.executeUserAppAction,
    pushUndoEntry: mocks.writes.pushUndoEntry,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    removeMidiNote: mocks.writes.removeMidiNote,
    setNotesForClip: mocks.writes.setNotesForClip,
    strumNotes: mocks.writes.strumNotes,
    getNotesForClip: vi.fn(() => []),
}));

const FROZEN_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';
const NOTES = [
    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
    { id: 'n2', pitch: 64, startBeat: 1, duration: 1, velocity: 100 },
];

const writeCallCount = (): number =>
    Object.values(mocks.writes).reduce((total, writer) => total + writer.mock.calls.length, 0);

const frozenWarnings = (): unknown[][] =>
    mocks.notifyUser.mock.calls.filter((call) => call[0] === FROZEN_MESSAGE && call[1] === 'warning');

const renderMenu = (): void => {
    render(
        <PianoRollContextMenu
            menu={{ x: 100, y: 100, beat: 4 }}
            clipId="clip-1"
            notes={NOTES}
            selectedNoteIds={new Set(['n1', 'n2'])}
            onClose={vi.fn()}
            onSelectAll={vi.fn()}
            onClearSelection={vi.fn()}
        />
    );
};

const editItems = ['Cut', 'Paste', 'Delete Selected', '↑ Up', 'AI Auto-Complete'];

describe('PianoRollContextMenu on a frozen track', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.writes.executeUserAppAction.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    describe.each(editItems)('%s', (label) => {
        it('writes nothing and warns once when the clip track is frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];
            renderMenu();

            fireEvent.click(screen.getByText(label));

            expect(writeCallCount()).toBe(0);
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('still writes with no frozen warning when the track is not frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: false, clips: [{ id: 'clip-1' }] }];
            renderMenu();

            fireEvent.click(screen.getByText(label));

            expect(writeCallCount()).toBeGreaterThan(0);
            expect(frozenWarnings()).toHaveLength(0);
        });
    });

    describe('Apply Groove', () => {
        const applyGrooveCalls = (): unknown[][] =>
            mocks.writes.executeUserAppAction.mock.calls.filter((call) => call[0]?.type === 'applyGroove');

        const chooseGrooveThenApply = async (): Promise<void> => {
            renderMenu();
            fireEvent.click(screen.getByText('Extract Groove'));
            await waitFor(() => expect(screen.getByText('Apply Groove (50%)')).toBeEnabled());
            fireEvent.click(screen.getByText('Apply Groove (50%)'));
        };

        it('assigns no groove and warns once when the clip track is frozen', async () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];

            await chooseGrooveThenApply();

            expect(applyGrooveCalls()).toHaveLength(0);
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('still assigns the groove with no frozen warning when the track is not frozen', async () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: false, clips: [{ id: 'clip-1' }] }];

            await chooseGrooveThenApply();

            await waitFor(() => expect(applyGrooveCalls()).toHaveLength(1));
            expect(frozenWarnings()).toHaveLength(0);
        });
    });

    it('keeps Copy available on a frozen track without a warning', () => {
        mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];
        renderMenu();

        fireEvent.click(screen.getByText('Copy'));

        expect(mocks.copySelectedNotes).toHaveBeenCalledWith('clip-1', ['n1', 'n2']);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
