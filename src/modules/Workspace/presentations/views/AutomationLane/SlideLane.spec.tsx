import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlideLane } from './SlideLane';

vi.mock('./NotePropertyLane', () => ({
    NotePropertyLane: (props: { label: string; clipId: string | null }) => (
        <div data-testid="note-property-lane" data-label={props.label} data-clip-id={props.clipId}>
            NotePropertyLane: {props.label}
        </div>
    ),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/setNoteSlide', () => ({
    setNoteSlide: vi.fn(),
}));

describe('SlideLane', () => {
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
        render(<SlideLane {...defaultProps} />);
        expect(screen.getByTestId('note-property-lane')).toBeInTheDocument();
    });

    it('should pass correct label to NotePropertyLane', () => {
        render(<SlideLane {...defaultProps} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-label', 'Slide');
    });

    it('should pass clipId to NotePropertyLane', () => {
        render(<SlideLane {...defaultProps} clipId="test-clip" />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'test-clip');
    });

    it('should pass null clipId when not provided', () => {
        render(<SlideLane {...defaultProps} clipId={null} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'null');
    });

    it('should display NotePropertyLane content', () => {
        render(<SlideLane {...defaultProps} />);
        expect(screen.getByText('NotePropertyLane: Slide')).toBeInTheDocument();
    });
});
