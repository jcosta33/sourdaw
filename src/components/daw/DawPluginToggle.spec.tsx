import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawPluginToggle } from './DawPluginToggle';

describe('DawPluginToggle', () => {
    it('should show on or off label via DawPluginChip', () => {
        const { rerender } = render(<DawPluginToggle pressed={false} aria-label="Bypass" />);
        expect(screen.getByRole('button', { name: 'Bypass' })).toHaveTextContent('OFF');
        rerender(<DawPluginToggle pressed aria-label="Bypass" />);
        expect(screen.getByRole('button', { name: 'Bypass' })).toHaveTextContent('ON');
    });
});
