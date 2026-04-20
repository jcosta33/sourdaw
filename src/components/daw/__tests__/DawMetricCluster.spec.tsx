import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawMetricCluster } from '../DawMetricCluster';

describe('DawMetricCluster', () => {
    it('should render label meter value and children', () => {
        const { container } = render(
            <DawMetricCluster label="CPU" meter={<span data-testid="m">bar</span>} value="12%">
                extra
            </DawMetricCluster>
        );
        expect(screen.getByText('CPU')).toBeInTheDocument();
        expect(screen.getByTestId('m')).toBeInTheDocument();
        expect(container.textContent).toContain('12%');
        expect(container.textContent).toContain('extra');
    });
});
