import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotePropertyLane } from '../NotePropertyLane';

vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: { value: { notesByClipId: {} } },
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));

vi.mock('#/modules/Command/useCases/pushUndoEntry', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/helpers/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('../../../helpers/oklchColor', () => ({
    colorWithAlpha: vi.fn((color: string, alpha: number) => color),
    brightenColor: vi.fn((color: string) => color),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, fallback) => fallback || store.value),
}));

describe('NotePropertyLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        beatWidth: 40,
        contentWidth: 800,
        getValue: (note: { velocity: number }) => note.velocity,
        setValue: vi.fn(),
        label: 'Velocity',
        undoLabel: 'Change velocity',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<NotePropertyLane {...defaultProps} />);
        expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('should render with correct aria-label', () => {
        render(<NotePropertyLane {...defaultProps} />);
        expect(screen.getByLabelText('Velocity lane')).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<NotePropertyLane {...defaultProps} />);
        expect(screen.getByRole('group').querySelector('canvas')).toBeInTheDocument();
    });

    it('should render with correct label', () => {
        render(<NotePropertyLane {...defaultProps} label="Test Label" />);
        expect(screen.getByLabelText('Test Label lane')).toBeInTheDocument();
    });
});
