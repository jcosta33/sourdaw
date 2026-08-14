import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { copySelectedNotes, pasteNotes } from '#/modules/Arrangement/useCases';
import { executeAppAction, pushUndoEntry } from '#/modules/Command/useCases';
import {
    addMidiNote,
    getNotesForClip,
    humanizeNotes,
    moveMidiNote,
    removeMidiNote,
    restoreStrumOriginals,
    setNoteVelocity,
    snapClipToScale,
    strumNotes,
} from '#/modules/MIDI/useCases';

import { PianoRollContextMenu } from '../PianoRollContextMenu';

vi.mock('#/components/daw/DawContextMenuSurface', () => ({
    DawContextMenuSurface: ({
        children,
        ref,
    }: {
        children: React.ReactNode;
        ref?: React.RefObject<HTMLDivElement>;
    }) => <div ref={ref}>{children}</div>,
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({
        children,
        onClick,
        disabled,
        shortcut,
        role,
        className,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        shortcut?: string;
        role?: string;
        className?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={className}
            data-shortcut={shortcut}
            role={role}
        >
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
    DawMenuSeparator: () => <hr />,
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: vi.fn(),
    executeAppAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addMidiNote: vi.fn(),
    removeMidiNote: vi.fn(),
    moveMidiNote: vi.fn(),
    setNoteVelocity: vi.fn(),
    getNotesForClip: vi.fn(() => []),
    humanizeNotes: vi.fn(),
    restoreStrumOriginals: vi.fn(),
    strumNotes: vi.fn(),
    restoreGrooveOriginals: vi.fn(),
    applyGrooveToClip: vi.fn(),
    extractGrooveFromClip: vi.fn(),
    snapClipToScale: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    copySelectedNotes: vi.fn(),
    pasteNotes: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('PianoRollContextMenu', () => {
    const defaultProps = {
        menu: { x: 100, y: 100, beat: 4, pitch: 60 },
        clipId: 'clip-1',
        notes: [] as { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[],
        selectedNoteIds: new Set<string>(),
        onClose: vi.fn(),
        onSelectAll: vi.fn(),
        onClearSelection: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('should render Select All button', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('should call onSelectAll when Select All is clicked', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('Select All'));
        expect(defaultProps.onSelectAll).toHaveBeenCalled();
    });

    it('should render Copy button', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    it('should render Cut button', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Cut')).toBeInTheDocument();
    });

    it('should render Paste button', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Paste')).toBeInTheDocument();
    });

    it('should render quantize options', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Quantize')).toBeInTheDocument();
    });

    it('should render transpose options', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Transpose')).toBeInTheDocument();
    });

    it('should render humanize options', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getAllByText(/Humanize/i).length).toBeGreaterThan(0);
    });

    it('should render strum options', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Strum')).toBeInTheDocument();
    });

    it('should render AI Auto-Complete button', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('AI Auto-Complete')).toBeInTheDocument();
    });

    it('should render Groove section', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Groove')).toBeInTheDocument();
    });

    it('should render Delete Selected button', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Delete Selected')).toBeInTheDocument();
    });

    it('should disable Delete Selected when no notes selected', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set()} />);
        const deleteButton = screen.getByText('Delete Selected');
        expect(deleteButton).toBeDisabled();
    });

    it('should disable Copy when no notes selected', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set()} />);
        const copyButton = screen.getByText('Copy');
        expect(copyButton).toBeDisabled();
    });

    it('should copy the selected note ids and close the menu', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set(['n1', 'n2'])} />);
        fireEvent.click(screen.getByText('Copy'));
        expect(copySelectedNotes).toHaveBeenCalledWith('clip-1', ['n1', 'n2']);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should paste at the menu beat', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('Paste'));
        expect(pasteNotes).toHaveBeenCalledWith('clip-1', 4);
    });

    it('should cut the selected notes and restore them on undo', () => {
        const notes = [
            { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
            { id: 'n2', pitch: 64, startBeat: 1, duration: 0.5, velocity: 90 },
        ];
        renderWithTooltip(
            <PianoRollContextMenu {...defaultProps} notes={notes} selectedNoteIds={new Set(['n1', 'n2'])} />
        );
        fireEvent.click(screen.getByText('Cut'));

        expect(copySelectedNotes).toHaveBeenCalledWith('clip-1', ['n1', 'n2']);
        expect(removeMidiNote).toHaveBeenCalledWith('clip-1', 'n1');
        expect(removeMidiNote).toHaveBeenCalledWith('clip-1', 'n2');
        expect(defaultProps.onClearSelection).toHaveBeenCalled();
        expect(pushUndoEntry).toHaveBeenCalledWith('Cut 2 notes', expect.any(Function), expect.any(Function));

        const [, undo, redo] = vi.mocked(pushUndoEntry).mock.calls[0]!;
        undo();
        expect(addMidiNote).toHaveBeenCalledWith('clip-1', 60, 0, 1, 100);
        expect(addMidiNote).toHaveBeenCalledWith('clip-1', 64, 1, 0.5, 90);

        vi.mocked(removeMidiNote).mockClear();
        redo();
        expect(removeMidiNote).toHaveBeenCalledWith('clip-1', 'n1');
        expect(removeMidiNote).toHaveBeenCalledWith('clip-1', 'n2');
    });

    it('should quantize notes through the AppAction boundary', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('1/4'));

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'quantizeNotes',
            payload: { clipId: 'clip-1', gridSize: 0.25 },
        });
        expect(pushUndoEntry).not.toHaveBeenCalled();
    });

    it('should transpose notes through the AppAction boundary', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('+Oct'));

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'transposeNotes',
            payload: { clipId: 'clip-1', semitones: 12 },
        });
        expect(pushUndoEntry).not.toHaveBeenCalled();
    });

    it('should snap notes to scale and restore original pitches on undo', () => {
        vi.mocked(getNotesForClip)
            .mockReturnValueOnce([{ id: 'n1', pitch: 61, startBeat: 0, duration: 1, velocity: 100 }])
            .mockReturnValueOnce([{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('Snap to Scale'));
        expect(snapClipToScale).toHaveBeenCalledWith('clip-1');
        expect(pushUndoEntry).toHaveBeenCalledWith('Snap notes to scale', expect.any(Function), expect.any(Function));

        const [, undo, redo] = vi.mocked(pushUndoEntry).mock.calls[0]!;
        undo();
        expect(moveMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 61, 0);
        redo();
        expect(moveMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 60, 0);
    });

    it('should humanize notes by the subtle amount', () => {
        vi.mocked(getNotesForClip)
            .mockReturnValueOnce([{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }])
            .mockReturnValueOnce([{ id: 'n1', pitch: 60, startBeat: 0.03, duration: 1, velocity: 105 }]);
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('Humanize (subtle)'));
        expect(humanizeNotes).toHaveBeenCalledWith('clip-1', 0.02);
        expect(pushUndoEntry).toHaveBeenCalledWith('Humanize (subtle)', expect.any(Function), expect.any(Function));

        const [, undo, redo] = vi.mocked(pushUndoEntry).mock.calls[0]!;
        undo();
        expect(moveMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 60, 0);
        expect(setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n1', 100);
        redo();
        expect(moveMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 60, 0.03);
        expect(setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n1', 105);
    });

    it('should disable strum buttons with fewer than two selected notes', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set(['n1'])} />);
        expect(screen.getByText('↑ Up')).toBeDisabled();
    });

    it('should strum the selected notes and push an undo entry when originals are returned', () => {
        vi.mocked(strumNotes).mockReturnValueOnce(new Map([['n1', 0]]));
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set(['n1', 'n2'])} />);
        fireEvent.click(screen.getByText('↑ Up'));

        expect(strumNotes).toHaveBeenCalledWith('clip-1', ['n1', 'n2'], 0.04, 'up', expect.any(Number));
        expect(pushUndoEntry).toHaveBeenCalledWith('Strum up', expect.any(Function), expect.any(Function));

        const [, undo, redo] = vi.mocked(pushUndoEntry).mock.calls[0]!;
        undo();
        expect(restoreStrumOriginals).toHaveBeenCalledWith('clip-1', new Map([['n1', 0]]));
        redo();
        expect(strumNotes).toHaveBeenCalledTimes(2);
        // Redo replays the transform by re-invoking it, so it has to land on the
        // offsets it is replaying rather than on a fresh random draw.
        const [applyCall, redoCall] = vi.mocked(strumNotes).mock.calls;
        expect(redoCall).toEqual(applyCall);
    });

    it('routes AI auto-complete through the provider-neutral AppAction handler', async () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('AI Auto-Complete'));

        expect(defaultProps.onClose).toHaveBeenCalled();
        await waitFor(() =>
            expect(executeAppAction).toHaveBeenCalledWith(
                { type: 'completeMidi', payload: { clipId: 'clip-1', direction: 'forward', bars: 4 } },
                { source: 'ai' }
            )
        );
    });

    it('should extract a groove template and then enable applying it', async () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} clipId="clip-9" />);
        const applyButton = screen.getByText('Apply Groove (50%)');
        expect(applyButton).toBeDisabled();

        fireEvent.click(screen.getByText('Extract Groove'));
        await waitFor(() =>
            expect(executeAppAction).toHaveBeenCalledWith({
                type: 'extractGroove',
                payload: { clipId: 'clip-9', templateId: 'groove-clip-9-v1' },
            })
        );
        await waitFor(() => expect(applyButton).not.toBeDisabled());

        fireEvent.click(applyButton);
        await waitFor(() =>
            expect(executeAppAction).toHaveBeenCalledWith({
                type: 'applyGroove',
                payload: { clipId: 'clip-9', grooveId: 'groove-straight', amount: 0.5 },
            })
        );
    });

    it('should delete the selected notes and restore them on undo', () => {
        const notes = [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} notes={notes} selectedNoteIds={new Set(['n1'])} />);
        fireEvent.click(screen.getByText('Delete Selected'));

        expect(removeMidiNote).toHaveBeenCalledWith('clip-1', 'n1');
        expect(defaultProps.onClearSelection).toHaveBeenCalled();
        expect(pushUndoEntry).toHaveBeenCalledWith('Delete 1 note', expect.any(Function), expect.any(Function));

        const [, undo, redo] = vi.mocked(pushUndoEntry).mock.calls[0]!;
        undo();
        expect(addMidiNote).toHaveBeenCalledWith('clip-1', 60, 0, 1, 100);

        vi.mocked(removeMidiNote).mockClear();
        redo();
        expect(removeMidiNote).toHaveBeenCalledWith('clip-1', 'n1');
    });
});
