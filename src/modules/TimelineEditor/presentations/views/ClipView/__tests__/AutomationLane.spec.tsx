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

// The lane selector reads the edited track's devices to decide whether the MPE
// lanes are worth offering (audit MD-2), so the spec drives that store.
const trackDevices = vi.hoisted(() => ({ value: [] as { type: string }[] }));

function setTrackDevices(devices: { type: string }[]): void {
    trackDevices.value = devices;
}

vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ tracks: [{ id: 'track-1', devices: trackDevices.value }] }),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: null },
    defaultTrackState: { tracks: [] },
    // A barrel factory replaces the whole module, so every member anything in
    // this spec's graph imports has to be present here — Automation's range
    // handlers reach both of these, and neither is exercised by these cases.
    markerStore: { value: null, subscribe: vi.fn() },
    resolveEligibleDeviceWriteTarget: vi.fn(() => null),
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

    // audit MD-2 — the MPE lanes follow the track's own instrument: offered when
    // the engine sounds per-note expression, withheld when it does not.
    describe('MPE lanes track the instrument that would sound them', () => {
        afterEach(() => {
            setTrackDevices([]);
        });

        it('withholds every MPE lane for a track whose instrument sounds none', () => {
            setTrackDevices([{ type: 'toaster' }]);
            render(<AutomationLane {...defaultProps} />);

            const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
            expect(values).not.toContain('pressure');
            expect(values).not.toContain('slide');
            expect(values).not.toContain('pitchBend');
        });

        it('offers Grand Boule pitch bend but withholds pressure and slide, which it cannot sound', () => {
            setTrackDevices([{ type: 'grand-boule' }]);
            render(<AutomationLane {...defaultProps} />);

            const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
            expect(values).toContain('pitchBend');
            expect(values).not.toContain('pressure');
            expect(values).not.toContain('slide');
        });

        it('routes the pressure lane for a track whose instrument sounds per-note expression', () => {
            setTrackDevices([{ type: 'fermenter' }]);
            render(<AutomationLane {...defaultProps} />);

            fireEvent.change(screen.getByLabelText('Automation lane type'), { target: { value: 'pressure' } });
            expect(screen.getByTestId('pressure-lane')).toBeInTheDocument();
        });

        it('routes the slide lane for a track whose instrument sounds per-note expression', () => {
            setTrackDevices([{ type: 'fermenter' }]);
            render(<AutomationLane {...defaultProps} />);

            fireEvent.change(screen.getByLabelText('Automation lane type'), { target: { value: 'slide' } });
            expect(screen.getByTestId('slide-lane')).toBeInTheDocument();
        });

        it('routes the pitch bend lane for a track whose instrument sounds per-note expression', () => {
            setTrackDevices([{ type: 'levain' }]);
            render(<AutomationLane {...defaultProps} />);

            fireEvent.change(screen.getByLabelText('Automation lane type'), { target: { value: 'pitchBend' } });
            expect(screen.getByTestId('pitchbend-lane')).toBeInTheDocument();
        });
    });
});
