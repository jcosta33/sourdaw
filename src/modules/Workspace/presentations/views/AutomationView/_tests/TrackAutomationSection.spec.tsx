import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackAutomationSection } from '../TrackAutomationSection';

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) classes.push(key);
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('../AutomationLaneRow', () => ({
    AutomationLaneRow: ({ lane }: { lane: { id: string } }) => (
        <div data-testid={`lane-row-${lane.id}`}>LaneRow: {lane.id}</div>
    ),
}));

vi.mock('../AutomationControls', () => ({
    AutomationModeControl: ({ automationMode, laneCount, onModeChange }: { automationMode: string; laneCount: number; onModeChange: (mode: string) => void }) => (
        <div data-testid="mode-control" data-mode={automationMode} data-count={laneCount}>
            <button type="button" onClick={() => onModeChange('touch')}>
                Change Mode
            </button>
        </div>
    ),
    AutomationAddLaneControl: ({ params, onAdd }: { params: { id: string; name: string }[]; onAdd: (id: string, name: string) => void }) => (
        <div data-testid="add-lane-control">
            {params.map((p) => (
                <button key={p.id} type="button" onClick={() => onAdd(p.id, p.name)}>
                    Add {p.name}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../../../helpers/automationViewHelpers', () => ({
    getAutomatableParams: vi.fn(() => [
        { id: 'volume', name: 'Volume' },
        { id: 'pan', name: 'Pan' },
    ]),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({ lanes: [] })),
}));

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: { value: { lanes: [] } },
}));

vi.mock('#/modules/Automation/useCases/automation/addAutomationLane', () => ({
    addAutomationLane: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases/automation/toggleLaneCollapsed', () => ({
    toggleLaneCollapsed: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/setAutomationMode', () => ({
    setAutomationMode: vi.fn(),
}));

describe('TrackAutomationSection', () => {
    const defaultProps = {
        trackId: 'track-1',
        trackName: 'Test Track',
        trackColor: '#ff0000',
        automationMode: 'read' as const,
        devices: [{ type: 'synth', name: 'Synth 1' }],
        pixelsPerBeat: 12,
        scrollX: 0,
        containerWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should display track name', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should render track color indicator', () => {
        const { container } = render(<TrackAutomationSection {...defaultProps} trackColor="#00ff00" />);
        const colorIndicator = container.querySelector('[style*="background-color: rgb(0, 255, 0)"]') ||
            container.querySelector('[style*="#00ff00"]');
        expect(colorIndicator).toBeTruthy();
    });

    it('should render automation mode control', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        expect(screen.getByTestId('mode-control')).toBeInTheDocument();
    });

    it('should render add lane control', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        expect(screen.getByTestId('add-lane-control')).toBeInTheDocument();
    });

    it('should toggle expansion when header is clicked', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        const header = screen.getByText('Test Track').closest('div');
        if (header) {
            fireEvent.click(header);
            // After clicking, the lanes section should be collapsed
            expect(screen.queryByTestId('add-lane-control')).not.toBeInTheDocument();
        }
    });

    it('should show lane count in mode control', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        const modeControl = screen.getByTestId('mode-control');
        expect(modeControl).toHaveAttribute('data-mode', 'read');
        expect(modeControl).toHaveAttribute('data-count', '0');
    });
});
