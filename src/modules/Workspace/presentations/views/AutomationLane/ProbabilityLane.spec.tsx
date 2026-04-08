import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProbabilityLane } from './ProbabilityLane';

vi.mock('./NotePropertyLane', () => ({
    NotePropertyLane: (props: { label: string; clipId: string | null }) => (
        <div data-testid="note-property-lane" data-label={props.label} data-clip-id={props.clipId}>
            NotePropertyLane: {props.label}
        </div>
    ),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/setNoteProbability', () => ({
    setNoteProbability: vi.fn(),
}));

describe('ProbabilityLane', () => {
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
        render(<ProbabilityLane {...defaultProps} />);
        expect(screen.getByTestId('note-property-lane')).toBeInTheDocument();
    });

    it('should pass correct label to NotePropertyLane', () => {
        render(<ProbabilityLane {...defaultProps} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-label', 'Probability');
    });

    it('should pass clipId to NotePropertyLane', () => {
        render(<ProbabilityLane {...defaultProps} clipId="test-clip" />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'test-clip');
    });

    it('should pass null clipId when not provided', () => {
        render(<ProbabilityLane {...defaultProps} clipId={null} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'null');
    });

    it('should display NotePropertyLane content', () => {
        render(<ProbabilityLane {...defaultProps} />);
        expect(screen.getByText('NotePropertyLane: Probability')).toBeInTheDocument();
    });
});
