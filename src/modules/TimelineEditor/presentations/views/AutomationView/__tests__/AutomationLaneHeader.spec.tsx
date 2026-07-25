import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AutomationLaneHeader } from '../AutomationLaneHeader';

vi.mock('#/components/daw/DawMicroBadge', () => ({
    DawMicroBadge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <span className={className}>{children}</span>
    ),
}));

vi.mock('../../../helpers/automationLaneConstants', () => ({
    formatParameterValue: (value: number, _paramId: string) => `${value.toFixed(2)}`,
}));

describe('AutomationLaneHeader', () => {
    const defaultProps = {
        parameterName: 'Volume',
        parameterId: 'volume',
        curveColor: '#ff0000',
        currentValue: 75,
        isDrawMode: false,
        isYZoomed: false,
        viewMin: 0,
        viewMax: 100,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationLaneHeader {...defaultProps} />);
        expect(screen.getByText('Volume')).toBeInTheDocument();
    });

    it('should display parameter name', () => {
        render(<AutomationLaneHeader {...defaultProps} />);
        expect(screen.getByText('Volume')).toBeInTheDocument();
    });

    it('should display current value when provided', () => {
        render(<AutomationLaneHeader {...defaultProps} currentValue={75} />);
        expect(screen.getByText('75.00')).toBeInTheDocument();
    });

    it('should not display current value badge when currentValue is null', () => {
        render(<AutomationLaneHeader {...defaultProps} currentValue={null} />);
        expect(screen.queryByText('75.00')).not.toBeInTheDocument();
    });

    it('should show DRAW badge when in draw mode', () => {
        render(<AutomationLaneHeader {...defaultProps} isDrawMode={true} />);
        expect(screen.getByText('DRAW')).toBeInTheDocument();
    });

    it('should not show DRAW badge when not in draw mode', () => {
        render(<AutomationLaneHeader {...defaultProps} isDrawMode={false} />);
        expect(screen.queryByText('DRAW')).not.toBeInTheDocument();
    });

    it('never shows a VT badge (AU-8, flag removed)', () => {
        render(<AutomationLaneHeader {...defaultProps} />);
        expect(screen.queryByText('VT')).not.toBeInTheDocument();
    });

    it('should show Y-zoom badge when Y-zoomed', () => {
        render(<AutomationLaneHeader {...defaultProps} isYZoomed={true} viewMin={0.2} viewMax={0.8} />);
        expect(screen.getByText('Y:20–80%')).toBeInTheDocument();
    });

    it('should not show Y-zoom badge when not Y-zoomed', () => {
        render(<AutomationLaneHeader {...defaultProps} isYZoomed={false} />);
        expect(screen.queryByText(/Y:/)).not.toBeInTheDocument();
    });

    it('should render color indicator', () => {
        const { container } = render(<AutomationLaneHeader {...defaultProps} curveColor="#ff0000" />);
        const colorIndicator =
            container.querySelector('[style*="background-color: rgb(255, 0, 0)"]') ||
            container.querySelector('[style*="#ff0000"]');
        expect(colorIndicator).toBeTruthy();
    });
});
