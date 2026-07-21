import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawPluginMetricStrip } from '../DawPluginMetricStrip';

describe('DawPluginMetricStrip', () => {
    it('renders an end-aligned wrapping row by default and preserves child order', () => {
        render(
            <DawPluginMetricStrip data-testid="metric-strip">
                <span>input</span>
                <span>output</span>
            </DawPluginMetricStrip>
        );

        const metricStrip = screen.getByTestId('metric-strip');

        expect(metricStrip.tagName).toBe('DIV');
        expect(metricStrip).toHaveClass(
            'flex',
            'flex-row',
            'min-w-0',
            'flex-wrap',
            'gap-2',
            'items-center',
            'justify-end'
        );
        expect(Array.from(metricStrip.children, (child) => child.textContent)).toEqual(['input', 'output']);
    });

    it('maps start alignment without changing the wrapping and gap contract', () => {
        render(
            <DawPluginMetricStrip data-testid="metric-strip" align="start">
                metrics
            </DawPluginMetricStrip>
        );

        expect(screen.getByTestId('metric-strip')).toHaveClass('justify-start', 'flex-wrap', 'gap-2');
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawPluginMetricStrip
                data-testid="metric-strip"
                data-state="active"
                aria-label="Plugin metrics"
                role="group"
                style={{ minWidth: '160px' }}
                onClick={handleClick}
            >
                metrics
            </DawPluginMetricStrip>
        );

        const metricStrip = screen.getByRole('group', { name: 'Plugin metrics' });

        expect(metricStrip).toHaveAttribute('data-state', 'active');
        expect(metricStrip).toHaveStyle({ minWidth: '160px' });

        fireEvent.click(metricStrip);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting row defaults', () => {
        render(
            <DawPluginMetricStrip data-testid="metric-strip" className="flex-nowrap gap-4 items-start justify-center">
                metrics
            </DawPluginMetricStrip>
        );

        const metricStrip = screen.getByTestId('metric-strip');

        expect(metricStrip).toHaveClass('flex-nowrap', 'gap-4', 'items-start', 'justify-center');
        expect(metricStrip).not.toHaveClass('flex-wrap', 'gap-2', 'items-center', 'justify-end');
    });
});
