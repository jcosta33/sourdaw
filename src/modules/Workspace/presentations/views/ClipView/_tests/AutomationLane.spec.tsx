import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationLane } from '../AutomationLane';

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({ id, value, onChange, children, size, 'aria-label': ariaLabel }: { id: string; value: string; onChange: (e: { target: { value: string } }) => void; children: React.ReactNode; size: string; 'aria-label'?: string }) => (
        <select id={id} value={value} onChange={onChange} data-size={size} aria-label={ariaLabel}>
            {children}
        </select>
    ),
}));

vi.mock('../../AutomationLane/VelocityLane', () => ({
    VelocityLane: () => <div data-testid="velocity-lane">Velocity Lane</div>,
}));

vi.mock('../../AutomationLane/ProbabilityLane', () => ({
    ProbabilityLane: () => <div data-testid="probability-lane">Probability Lane</div>,
}));

vi.mock('../../AutomationLane/PressureLane', () => ({
    PressureLane: () => <div data-testid="pressure-lane">Pressure Lane</div>,
}));

vi.mock('../../AutomationLane/SlideLane', () => ({
    SlideLane: () => <div data-testid="slide-lane">Slide Lane</div>,
}));

vi.mock('../../AutomationLane/CCLane', () => ({
    CCLane: ({ controller }: { controller: number }) => <div data-testid="cc-lane" data-controller={controller}>CC Lane {controller}</div>,
}));

vi.mock('../../AutomationLane/PitchBendLane', () => ({
    PitchBendLane: () => <div data-testid="pitchbend-lane">Pitch Bend Lane</div>,
}));

describe('AutomationLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        beatWidth: 40,
        contentWidth: 800,
        scrollRef: { current: null as HTMLDivElement | null },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationLane {...defaultProps} />);
        expect(screen.getByLabelText('Automation lane type')).toBeInTheDocument();
    });

    it('should render lane selector dropdown', () => {
        render(<AutomationLane {...defaultProps} />);
        expect(screen.getByLabelText('Automation lane type')).toBeInTheDocument();
    });

    it('should render velocity lane by default', () => {
        render(<AutomationLane {...defaultProps} />);
        expect(screen.getByTestId('velocity-lane')).toBeInTheDocument();
    });

    it('should switch to probability lane', () => {
        render(<AutomationLane {...defaultProps} />);
        const select = screen.getByLabelText('Automation lane type');
        fireEvent.change(select, { target: { value: 'probability' } });
        expect(screen.getByTestId('probability-lane')).toBeInTheDocument();
    });

    it('should switch to pressure lane', () => {
        render(<AutomationLane {...defaultProps} />);
        const select = screen.getByLabelText('Automation lane type');
        fireEvent.change(select, { target: { value: 'pressure' } });
        expect(screen.getByTestId('pressure-lane')).toBeInTheDocument();
    });

    it('should switch to slide lane', () => {
        render(<AutomationLane {...defaultProps} />);
        const select = screen.getByLabelText('Automation lane type');
        fireEvent.change(select, { target: { value: 'slide' } });
        expect(screen.getByTestId('slide-lane')).toBeInTheDocument();
    });

    it('should switch to pitch bend lane', () => {
        render(<AutomationLane {...defaultProps} />);
        const select = screen.getByLabelText('Automation lane type');
        fireEvent.change(select, { target: { value: 'pitchBend' } });
        expect(screen.getByTestId('pitchbend-lane')).toBeInTheDocument();
    });

    it('should switch to CC lane', () => {
        render(<AutomationLane {...defaultProps} />);
        const select = screen.getByLabelText('Automation lane type');
        fireEvent.change(select, { target: { value: 'cc1' } });
        expect(screen.getByTestId('cc-lane')).toHaveAttribute('data-controller', '1');
    });

    it('should render all lane options', () => {
        render(<AutomationLane {...defaultProps} />);
        const options = screen.getAllByRole('option');
        expect(options.length).toBeGreaterThan(0);
    });

    it('should render piano-key gutter spacer', () => {
        const { container } = render(<AutomationLane {...defaultProps} />);
        const gutter = container.querySelector('[style*="40px"]');
        expect(gutter).toBeTruthy();
    });
});
