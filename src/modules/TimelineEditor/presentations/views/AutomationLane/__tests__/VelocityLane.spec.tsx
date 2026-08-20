import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { VelocityLane } from '../VelocityLane';

vi.mock('../NotePropertyLane', () => ({
    NotePropertyLane: (props: { label: string; clipId: string | null }) => (
        <div data-testid="note-property-lane" data-label={props.label} data-clip-id={props.clipId}>
            NotePropertyLane: {props.label}
        </div>
    ),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    setNoteVelocity: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('VelocityLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        beatWidth: 40,
        // NotePropertyLane is stubbed out here, so the scroll container it
        // would read is never consulted.
        scrollRef: { current: null },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<VelocityLane {...defaultProps} />);
        expect(screen.getByTestId('note-property-lane')).toBeInTheDocument();
    });

    it('should pass correct label to NotePropertyLane', () => {
        renderWithTooltip(<VelocityLane {...defaultProps} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-label', 'Velocity');
    });

    it('should pass clipId to NotePropertyLane', () => {
        renderWithTooltip(<VelocityLane {...defaultProps} clipId="test-clip" />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane).toHaveAttribute('data-clip-id', 'test-clip');
    });

    it('should pass null clipId when not provided', () => {
        renderWithTooltip(<VelocityLane {...defaultProps} clipId={null} />);
        const lane = screen.getByTestId('note-property-lane');
        expect(lane.getAttribute('data-clip-id')).toBeNull();
    });

    it('should display NotePropertyLane content', () => {
        renderWithTooltip(<VelocityLane {...defaultProps} />);
        expect(screen.getByText('NotePropertyLane: Velocity')).toBeInTheDocument();
    });
});
