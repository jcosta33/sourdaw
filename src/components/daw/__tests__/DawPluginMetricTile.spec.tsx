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
});
