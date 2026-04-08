import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PressureLane } from './PressureLane';

vi.mock('./NotePropertyLane', () => ({
    NotePropertyLane: (props: { label: string; clipId: string | null }) => (
        <div data-testid="note-property-lane" data-label={props.label} data-clip-id={props.clipId}>
            NotePropertyLane: {props.label}
        </div>
    ),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/setNotePressure', () => ({
    setNotePressure: vi.fn(),
}));

describe('PressureLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        beatWidth: 40,
        contentWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PressureLane {...defaultProps} />);
        expect(screen.getByTestId('note-property-lane')).toBeInTheDocument();
    });

    it('should pass correct label to NotePropertyLane', () => {
        render(<PressureLane {...defaultProps} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-label', 'Pressure');
    });

    it('should pass clipId to NotePropertyLane', () => {
        render(<PressureLane {...defaultProps} clipId="test-clip" />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'test-clip');
    });

    it('should pass null clipId when not provided', () => {
        render(<PressureLane {...defaultProps} clipId={null} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'null');
    });

    it('should display NotePropertyLane content', () => {
        render(<PressureLane {...defaultProps} />);
        expect(screen.getByText('NotePropertyLane: Pressure')).toBeInTheDocument();
    });
});
