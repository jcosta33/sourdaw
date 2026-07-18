import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AutomationLaneRow } from '../AutomationLaneRow';

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

vi.mock('../AutomationLaneHeader', () => ({
    AutomationLaneHeader: () => <div data-testid="lane-header">Header</div>,
}));

vi.mock('../AutomationLaneControls', () => ({
    AutomationLaneControls: () => <div data-testid="lane-controls">Controls</div>,
}));

vi.mock('../AutomationContextMenu', () => ({
    AutomationContextMenu: () => null,
}));

vi.mock('../../../helpers/automationViewHelpers', () => ({
    LANE_HEIGHT: 120,
    buildCurvePath: vi.fn(() => ''),
}));

vi.mock('../../../helpers/automationLaneConstants', () => ({
    formatParameterValue: vi.fn((value: number) => `${value.toFixed(2)}`),
    curveLabel: vi.fn(() => 'curve'),
}));

vi.mock('../../../helpers/automationDrag', () => ({
    onDrawMouseDown: vi.fn(),
    onRubberBandStart: vi.fn(),
    onTensionMouseDown: vi.fn(),
    onPointMouseDown: vi.fn(),
    applyCurveSelect: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        activeTool: 'pointer',
    })),
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { playheadPosition: 0 } },
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: { value: { activeTool: 'pointer' } },
    defaultWorkspaceState: { activeTool: 'pointer' },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAutomationRegions: vi.fn(() => []),
    interpolateAutomationValue: vi.fn(() => 0.5),
}));

describe('AutomationLaneRow', () => {
    const defaultProps = {
        lane: {
            id: 'lane-1',
            trackId: 'track-1',
            parameterId: 'volume',
            parameterName: 'Volume',
            minValue: 0,
            maxValue: 1,
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            virginTerritory: false,
        },
        trackColor: '#ff0000',
        pixelsPerBeat: 12,
        scrollX: 0,
        containerWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        expect(screen.getByTestId('lane-header')).toBeInTheDocument();
    });

    it('should render lane header', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        expect(screen.getByTestId('lane-header')).toBeInTheDocument();
    });

    it('should render lane controls', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        expect(screen.getByTestId('lane-controls')).toBeInTheDocument();
    });

    it('should render SVG element', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        const svg = document.querySelector('svg');
        expect(svg).toBeInTheDocument();
    });

    it('should apply correct height', () => {
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const laneDiv = container.firstChild as HTMLElement;
        expect(laneDiv).toHaveStyle({ height: '120px' });
    });

    it('should set tabindex for keyboard navigation', () => {
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const laneDiv = container.firstChild as HTMLElement;
        expect(laneDiv).toHaveAttribute('tabIndex', '0');
    });
});
