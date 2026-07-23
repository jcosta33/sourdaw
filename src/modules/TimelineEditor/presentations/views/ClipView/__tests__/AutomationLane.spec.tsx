import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AutomationLane } from '../AutomationLane';

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        id,
        value,
        onChange,
        children,
        size,
        'aria-label': ariaLabel,
    }: {
        id: string;
        value: string;
        onChange: (e: { target: { value: string } }) => void;
        children: React.ReactNode;
        size: string;
        'aria-label'?: string;
    }) => (
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
    CCLane: ({ controller }: { controller: number }) => (
        <div data-testid="cc-lane" data-controller={controller}>
            CC Lane {controller}
        </div>
    ),
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

    it('does not offer the MPE Pressure lane while per-note expression is unavailable (MD-2)', () => {
        render(<AutomationLane {...defaultProps} />);
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).not.toContain('pressure');
        expect(screen.queryByTestId('pressure-lane')).not.toBeInTheDocument();
    });

    it('does not offer the MPE Slide (CC74) lane while per-note expression is unavailable (MD-2)', () => {
        render(<AutomationLane {...defaultProps} />);
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).not.toContain('slide');
        expect(screen.queryByTestId('slide-lane')).not.toBeInTheDocument();
    });

    it('does not offer the MPE Pitch Bend lane while per-note expression is unavailable (MD-2)', () => {
        render(<AutomationLane {...defaultProps} />);
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).not.toContain('pitchBend');
        expect(screen.queryByTestId('pitchbend-lane')).not.toBeInTheDocument();
    });

    it('still offers the non-MPE lanes (velocity, probability, CC)', () => {
        render(<AutomationLane {...defaultProps} />);
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).toContain('velocity');
        expect(values).toContain('probability');
        expect(values).toContain('cc1');
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

    // When Wave 4 flips MPE_EXPRESSION_AVAILABLE to true the MPE lanes return.
    // Cover the pressure/slide/pitchBend switch wiring (the render branches kept
    // in source) so a broken prop wire on those lanes cannot ship undetected.
    describe('MPE lanes when per-note expression is available (Wave-4 reversal)', () => {
        beforeEach(() => {
            vi.resetModules();
            vi.doMock('../../../helpers/mpeAvailability', async () => {
                const actual = await vi.importActual<typeof import('../../../helpers/mpeAvailability')>(
                    '../../../helpers/mpeAvailability'
                );
                return { ...actual, MPE_EXPRESSION_AVAILABLE: true };
            });
        });

        afterEach(() => {
            vi.doUnmock('../../../helpers/mpeAvailability');
            vi.resetModules();
        });

        it('switches to the pressure lane once available', async () => {
            const { AutomationLane: LiveAutomationLane } = await import('../AutomationLane');
            render(<LiveAutomationLane {...defaultProps} />);
            const select = screen.getByLabelText('Automation lane type');
            fireEvent.change(select, { target: { value: 'pressure' } });
            expect(screen.getByTestId('pressure-lane')).toBeInTheDocument();
        });

        it('switches to the slide lane once available', async () => {
            const { AutomationLane: LiveAutomationLane } = await import('../AutomationLane');
            render(<LiveAutomationLane {...defaultProps} />);
            const select = screen.getByLabelText('Automation lane type');
            fireEvent.change(select, { target: { value: 'slide' } });
            expect(screen.getByTestId('slide-lane')).toBeInTheDocument();
        });

        it('switches to the pitch bend lane once available', async () => {
            const { AutomationLane: LiveAutomationLane } = await import('../AutomationLane');
            render(<LiveAutomationLane {...defaultProps} />);
            const select = screen.getByLabelText('Automation lane type');
            fireEvent.change(select, { target: { value: 'pitchBend' } });
            expect(screen.getByTestId('pitchbend-lane')).toBeInTheDocument();
        });
    });
});
