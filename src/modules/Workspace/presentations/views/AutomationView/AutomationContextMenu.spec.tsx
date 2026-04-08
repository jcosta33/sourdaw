import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationContextMenu } from './AutomationContextMenu';

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
        <button type="button" onClick={onClick} className={className}>
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
    DawMenuSeparator: () => <hr />,
}));

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(' '),
}));

describe('AutomationContextMenu', () => {
    const defaultProps = {
        x: 100,
        y: 100,
        beat: 4,
        section: null as 'curve' | 'shape' | null,
        points: [] as { beat: number; value: number; curve: string }[],
        onCurveSelect: vi.fn(),
        onShapeInsert: vi.fn(),
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Curve Type')).toBeInTheDocument();
    });

    it('should show curve type section by default', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Curve Type')).toBeInTheDocument();
    });

    it('should show insert shape section by default', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Insert Shape')).toBeInTheDocument();
    });

    it('should not show curve type section when section is shape', () => {
        render(<AutomationContextMenu {...defaultProps} section="shape" />);
        expect(screen.queryByText('Curve Type')).not.toBeInTheDocument();
        expect(screen.getByText('Insert Shape')).toBeInTheDocument();
    });

    it('should call onClose when clicking backdrop', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        const backdrop = document.querySelector('.fixed.inset-0');
        if (backdrop) {
            fireEvent.click(backdrop);
            expect(defaultProps.onClose).toHaveBeenCalled();
        }
    });

    it('should call onCurveSelect when curve option is clicked', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        const stepOption = screen.getByText('Step');
        fireEvent.click(stepOption);
        expect(defaultProps.onCurveSelect).toHaveBeenCalledWith('step');
    });

    it('should call onShapeInsert when shape option is clicked', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        const rampUpOption = screen.getByText('Ramp Up');
        fireEvent.click(rampUpOption);
        expect(defaultProps.onShapeInsert).toHaveBeenCalledWith('rampUp');
    });

    it('should render all curve options', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Linear')).toBeInTheDocument();
        expect(screen.getByText('Step')).toBeInTheDocument();
        expect(screen.getByText('Smooth')).toBeInTheDocument();
        expect(screen.getByText('Exponential')).toBeInTheDocument();
    });

    it('should render all shape options', () => {
        render(<AutomationContextMenu {...defaultProps} />);
        expect(screen.getByText('Ramp Up')).toBeInTheDocument();
        expect(screen.getByText('Ramp Down')).toBeInTheDocument();
        expect(screen.getByText('Sine')).toBeInTheDocument();
        expect(screen.getByText('Triangle')).toBeInTheDocument();
    });
});
