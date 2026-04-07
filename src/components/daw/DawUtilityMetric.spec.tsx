import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawUtilityMetric } from './DawUtilityMetric';

describe('DawUtilityMetric', () => {
    it('should render meter when meterValue is set', () => {
        render(
            <DawUtilityMetric label="Load" value="40%" meterValue={40} startSlot={<span data-testid="s">i</span>} />
        );
        expect(screen.getByText('Load')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByTestId('s')).toBeInTheDocument();
    });
});
