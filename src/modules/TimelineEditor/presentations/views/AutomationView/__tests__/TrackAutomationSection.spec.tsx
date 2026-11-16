import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { toggleLaneCollapsed } from '#/modules/Automation/useCases';

import { TrackAutomationSection } from '../TrackAutomationSection';

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
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
    AutomationModeControl: ({
        automationMode,
        laneCount,
        onModeChange,
    }: {
        automationMode: string;
        laneCount: number;
        onModeChange: (mode: string) => void;
    }) => (
        <div data-testid="mode-control" data-mode={automationMode} data-count={laneCount}>
            <button type="button" onClick={() => onModeChange('touch')}>
                Change Mode
            </button>
        </div>
    ),
    AutomationAddLaneControl: ({
        params,
        onAdd,
    }: {
        params: { id: string; name: string }[];
        onAdd: (id: string, name: string) => void;
    }) => (
        <div data-testid="add-lane-control">
            {params.map((param) => (
                <button key={param.id} type="button" onClick={() => onAdd(param.id, param.name)}>
                    Add {param.name}
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

vi.mock('#/modules/Automation/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/stores')>()),
    automationStore: { value: { lanes: [] } },
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    addAutomationLane: vi.fn(),
    toggleLaneCollapsed: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
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
        vi.mocked(useStore).mockReturnValue({ lanes: [] });
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
        const colorIndicator =
            container.querySelector('[style*="background-color: rgb(0, 255, 0)"]') ||
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

    it('makes a collapsed lane sparkline a native button that expands the lane', () => {
        vi.mocked(useStore).mockReturnValue({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'pan',
                    parameterName: 'Pan',
                    minValue: -1,
                    maxValue: 1,
                    collapsed: true,
                    points: [
                        { beat: 0, value: 0 },
                        { beat: 4, value: 1 },
                    ],
                },
            ],
        });
        render(<TrackAutomationSection {...defaultProps} />);
        const sparkline = screen.getByRole('button', { name: 'Expand Pan lane' });
        expect(sparkline).toHaveAttribute('aria-expanded', 'false');
        // A native button is what makes Enter and Space activate it; jsdom does
        // not synthesise that activation, so the click stands in for it.
        expect(sparkline.tagName).toBe('BUTTON');
        expect(sparkline).toHaveAttribute('type', 'button');

        fireEvent.click(sparkline);

        expect(toggleLaneCollapsed).toHaveBeenCalledExactlyOnceWith('lane-1');
    });

    it('should show lane count in mode control', () => {
        render(<TrackAutomationSection {...defaultProps} />);
        const modeControl = screen.getByTestId('mode-control');
        expect(modeControl).toHaveAttribute('data-mode', 'read');
        expect(modeControl).toHaveAttribute('data-count', '0');
    });
});
