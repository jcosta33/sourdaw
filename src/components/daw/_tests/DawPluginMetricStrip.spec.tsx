import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawPluginMetricStrip } from '../DawPluginMetricStrip';

describe('DawPluginMetricStrip', () => {
    it('should justify start when align is start', () => {
        const { container } = render(<DawPluginMetricStrip align="start">x</DawPluginMetricStrip>);
        expect(container.firstChild).toHaveClass('justify-start');
    });
});
