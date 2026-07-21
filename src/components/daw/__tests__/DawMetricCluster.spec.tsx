import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawMetricCluster } from '../DawMetricCluster';

describe('DawMetricCluster', () => {
    it('renders the row contract in label, meter, value, then children order', () => {
        render(
            <DawMetricCluster
                data-testid="metric-cluster"
                label={<span>CPU</span>}
                meter={<span>meter</span>}
                value={<span>12%</span>}
            >
                <span>extra</span>
            </DawMetricCluster>
        );

        const metricCluster = screen.getByTestId('metric-cluster');

        expect(metricCluster.tagName).toBe('DIV');
        expect(metricCluster).toHaveClass('flex', 'flex-row', 'min-w-0', 'gap-1', 'items-center', 'justify-start');
        expect(Array.from(metricCluster.children, (child) => child.textContent)).toEqual([
            'CPU',
            'meter',
            '12%',
            'extra',
        ]);
    });

    it('omits the optional meter and value slots without changing label and child order', () => {
        render(
            <DawMetricCluster data-testid="metric-cluster" label="CPU">
                <span>extra</span>
            </DawMetricCluster>
        );

        const metricCluster = screen.getByTestId('metric-cluster');

        expect(metricCluster.children).toHaveLength(2);
        expect(Array.from(metricCluster.children, (child) => child.textContent)).toEqual(['CPU', 'extra']);
    });

    it('forwards hidden state, native props, events, styles, and refs', () => {
        const ref = createRef<HTMLDivElement>();
        const handleClick = vi.fn();

        render(
            <DawMetricCluster
                ref={ref}
                data-testid="metric-cluster"
                data-state="idle"
                aria-label="CPU status"
                role="status"
                hidden
                style={{ display: 'none' }}
                onClick={handleClick}
                label="CPU"
            />
        );

        const metricCluster = screen.getByTestId('metric-cluster');

        expect(ref.current).toBe(metricCluster);
        expect(metricCluster).toHaveAttribute('data-state', 'idle');
        expect(metricCluster).toHaveAttribute('aria-label', 'CPU status');
        expect(metricCluster).toHaveAttribute('hidden');
        expect(metricCluster).toHaveStyle({ display: 'none' });

        fireEvent.click(metricCluster);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting row defaults', () => {
        render(<DawMetricCluster data-testid="metric-cluster" className="gap-4 items-start justify-end" label="CPU" />);

        const metricCluster = screen.getByTestId('metric-cluster');

        expect(metricCluster).toHaveClass('gap-4', 'items-start', 'justify-end');
        expect(metricCluster).not.toHaveClass('gap-1', 'items-center', 'justify-start');
    });
});
