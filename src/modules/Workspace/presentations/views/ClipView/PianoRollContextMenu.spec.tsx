import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PianoRollContextMenu } from './PianoRollContextMenu';

vi.mock('#/components/daw/DawContextMenuSurface', () => ({
    DawContextMenuSurface: ({ children, ref }: { children: React.ReactNode; ref?: React.RefObject<HTMLDivElement> }) => (
        <div ref={ref}>{children}</div>
    ),
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({ children, onClick, disabled, shortcut, role, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; shortcut?: string; role?: string; className?: string }) => (
        <button type="button" onClick={onClick} disabled={disabled} className={className} data-shortcut={shortcut} role={role}>
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
    DawMenuSeparator: () => <hr />,
}));

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('#/modules/Command/useCases/pushUndoEntry', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/addMidiNote', () => ({
    addMidiNote: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/removeMidiNote', () => ({
    removeMidiNote: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/moveMidiNote', () => ({
    moveMidiNote: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/setNoteVelocity', () => ({
    setNoteVelocity: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/getNotesForClip', () => ({
    getNotesForClip: vi.fn(() => []),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteTransforms/humanizeNotes', () => ({
    humanizeNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteTransforms/quantizeNotes', () => ({
    quantizeNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteTransforms/transposeNotes', () => ({
    transposeNotes: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipboard/copySelectedNotes', () => ({
    copySelectedNotes: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipboard/pasteNotes', () => ({
    pasteNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/strumNotes', () => ({
    strumNotes: vi.fn(),
    restoreStrumOriginals: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/grooveExtraction', () => ({
    extractGrooveFromClip: vi.fn(),
    applyGrooveToClip: vi.fn(),
    restoreGrooveOriginals: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/nativeAiBridge', () => ({
    generateMidiAI: vi.fn(),
    isTauri: vi.fn(() => false),
}));

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
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render Select All button', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('should call onSelectAll when Select All is clicked', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        fireEvent.click(screen.getByText('Select All'));
        expect(defaultProps.onSelectAll).toHaveBeenCalled();
    });

    it('should render Copy button', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    it('should render Cut button', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Cut')).toBeInTheDocument();
    });

    it('should render Paste button', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Paste')).toBeInTheDocument();
    });

    it('should render quantize options', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Quantize')).toBeInTheDocument();
    });

    it('should render transpose options', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Transpose')).toBeInTheDocument();
    });

    it('should render humanize options', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText(/Humanize/)).toBeInTheDocument();
    });

    it('should render strum options', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Strum')).toBeInTheDocument();
    });

    it('should render AI Auto-Complete button', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('AI Auto-Complete')).toBeInTheDocument();
    });

    it('should render Groove section', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Groove')).toBeInTheDocument();
    });

    it('should render Delete Selected button', () => {
        render(<PianoRollContextMenu {...defaultProps} />);
        expect(screen.getByText('Delete Selected')).toBeInTheDocument();
    });

    it('should disable Delete Selected when no notes selected', () => {
        render(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set()} />);
        const deleteButton = screen.getByText('Delete Selected');
        expect(deleteButton).toBeDisabled();
    });

    it('should disable Copy when no notes selected', () => {
        render(<PianoRollContextMenu {...defaultProps} selectedNoteIds={new Set()} />);
        const copyButton = screen.getByText('Copy');
        expect(copyButton).toBeDisabled();
    });
});
