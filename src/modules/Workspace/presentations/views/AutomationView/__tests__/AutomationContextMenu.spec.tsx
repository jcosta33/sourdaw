import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { AutomationContextMenu } from '../AutomationContextMenu';

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: any[]) => inputs.filter(Boolean).join(' '),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('AutomationContextMenu', () => {
    const defaultProps = {
        x: 100,
        y: 100,
        beat: 4,
        section: null as any,
        points: [],
        onCurveSelect: vi.fn(),
        onShapeInsert: vi.fn(),
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render correctly', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Curve Type')).toBeInTheDocument();
        expect(screen.getByText('Insert Shape')).toBeInTheDocument();
    });

    it('should call onCurveSelect when curve option is clicked', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} />);
        const stepOption = screen.getByText(/Step/i);
        fireEvent.click(stepOption);
        expect(defaultProps.onCurveSelect).toHaveBeenCalledWith('step');
    });

    it('should call onShapeInsert when shape option is clicked', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} />);
        const sineOption = screen.getByText(/Sine/i);
        fireEvent.click(sineOption);
        expect(defaultProps.onShapeInsert).toHaveBeenCalledWith('sine');
    });

    it('should render all curve options', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Linear')).toBeInTheDocument();
        expect(screen.getByText(/Step/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Smooth/i).length).toBeGreaterThan(0);
        expect(screen.getByText('Exponential')).toBeInTheDocument();
    });

    it('should render all shape options', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText(/Sine/i)).toBeInTheDocument();
        expect(screen.getByText(/Triangle/i)).toBeInTheDocument();
        expect(screen.getByText(/Sawtooth Up/i)).toBeInTheDocument();
        expect(screen.getByText(/Sawtooth Down/i)).toBeInTheDocument();
        expect(screen.getByText(/Square/i)).toBeInTheDocument();
        expect(screen.getByText(/Random/i)).toBeInTheDocument();
    });

    it('should only render shape section when section is "shape"', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} section="shape" />);
        expect(screen.queryByText('Curve Type')).not.toBeInTheDocument();
        expect(screen.getByText('Insert Shape')).toBeInTheDocument();
    });

    it('should only render curve section when section is "curve"', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} section="curve" />);
        expect(screen.getByText('Curve Type')).toBeInTheDocument();
        expect(screen.getByText('Insert Shape')).toBeInTheDocument();
    });

    it('should call onClose when background overlay is clicked', () => {
        renderWithTooltip(<AutomationContextMenu {...defaultProps} />);
        const overlay = document.body.querySelector('.fixed.inset-0');
        fireEvent.click(overlay!);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });
});
