import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawUtilityMetric } from '../DawUtilityMetric';

describe('DawUtilityMetric', () => {
    it('should render meter when meterValue is set', () => {
        render(
            <DawUtilityMetric label="Load" value="40%" meterValue={40} startSlot={<span data-testid="s">i</span>} />
        );
        expect(screen.getByText('Load')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByTestId('s')).toBeInTheDocument();
    });

    it('should omit meter when meterValue is undefined', () => {
        const { container } = render(<DawUtilityMetric label="CPU" value="ok" />);
        expect(container.querySelector('.bg-surface-overlay')).toBeNull();
    });

    it('should render children and optional meter styling', () => {
        render(
            <DawUtilityMetric
                label="Mix"
                value="12"
                valueClassName="font-bold"
                meterValue={0.5}
                meterFillClassName="bg-accent-cyan"
                className="extra"
            >
                <span data-testid="child">detail</span>
            </DawUtilityMetric>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
        expect(screen.getByText('detail')).toBeInTheDocument();
    });

    it('should render without start slot', () => {
        render(<DawUtilityMetric label="Solo" value="1" />);
        expect(screen.getByText('Solo')).toBeInTheDocument();
    });
});
