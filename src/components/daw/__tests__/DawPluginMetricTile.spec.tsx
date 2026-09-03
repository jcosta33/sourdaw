import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawPluginMetricTile } from '../DawPluginMetricTile';

describe('DawPluginMetricTile', () => {
    it('should render label value and detail', () => {
        render(<DawPluginMetricTile label="RMS" value="-12" detail="dBFS" />);
        expect(screen.getByText('RMS')).toBeInTheDocument();
        expect(screen.getByText('-12')).toBeInTheDocument();
        expect(screen.getByText('dBFS')).toBeInTheDocument();
    });

    it('supports compact mode with tighter padding and gap', () => {
        const { container } = render(<DawPluginMetricTile label="Cutoff" value="1000 Hz" detail="Res 1.0" compact />);
        expect(screen.getByText('Cutoff')).toBeInTheDocument();
        expect(screen.getByText('1000 Hz')).toBeInTheDocument();
        expect(screen.getByText('Res 1.0')).toBeInTheDocument();
        expect(container.firstElementChild).toHaveClass('gap-0.5');
        expect(container.firstElementChild).toHaveClass('px-2');
    });
});
