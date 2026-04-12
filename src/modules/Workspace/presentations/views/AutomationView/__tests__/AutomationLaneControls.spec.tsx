import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { AutomationLaneControls } from '../AutomationLaneControls';

vi.mock('#/utils/Styles/cn', () => ({
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

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('AutomationLaneControls', () => {
    const defaultProps = {
        laneId: 'lane-1',
        isVirginTerritory: false,
        isVisible: true,
        selectedCount: 0,
        onToggleVirginTerritory: vi.fn(),
        onZoomToUsedRange: vi.fn(),
        onToggleVisibility: vi.fn(),
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} />);
        expect(screen.getByLabelText('Enable virgin territory')).toBeInTheDocument();
    });

    it('should display selected count when greater than 0', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} selectedCount={3} />);
        expect(screen.getByText('3 sel')).toBeInTheDocument();
    });

    it('should not display selected count when 0', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} selectedCount={0} />);
        expect(screen.queryByText(/sel/)).not.toBeInTheDocument();
    });

    it('should call onToggleVirginTerritory when VT button is clicked', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} />);
        const vtButton = screen.getByLabelText('Enable virgin territory');
        fireEvent.click(vtButton);
        expect(defaultProps.onToggleVirginTerritory).toHaveBeenCalled();
    });

    it('should show different aria-label for VT button when virgin territory is enabled', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} isVirginTerritory={true} />);
        expect(screen.getByLabelText('Disable virgin territory')).toBeInTheDocument();
    });

    it('should show different aria-label for VT button when virgin territory is disabled', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} isVirginTerritory={false} />);
        expect(screen.getByLabelText('Enable virgin territory')).toBeInTheDocument();
    });

    it('should call onZoomToUsedRange when zoom button is clicked', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} />);
        const zoomButton = screen.getByLabelText('Zoom to used range');
        fireEvent.click(zoomButton);
        expect(defaultProps.onZoomToUsedRange).toHaveBeenCalled();
    });

    it('should call onToggleVisibility when visibility button is clicked', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} isVisible={true} />);
        const visibilityButton = screen.getByLabelText('Hide lane');
        fireEvent.click(visibilityButton);
        expect(defaultProps.onToggleVisibility).toHaveBeenCalled();
    });

    it('should show correct aria-label for visibility when visible', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} isVisible={true} />);
        expect(screen.getByLabelText('Hide lane')).toBeInTheDocument();
    });

    it('should show correct aria-label for visibility when hidden', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} isVisible={false} />);
        expect(screen.getByLabelText('Show lane')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} />);
        const closeButton = screen.getByLabelText('Close lane');
        fireEvent.click(closeButton);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should have correct button count', () => {
        renderWithTooltip(<AutomationLaneControls {...defaultProps} />);
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(4);
    });
});
