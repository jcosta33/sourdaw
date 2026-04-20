import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawPluginLed } from '../DawPluginLed';

describe('DawPluginLed', () => {
    it('should render children with tone', () => {
        const { container } = render(<DawPluginLed tone="cyan">ARM</DawPluginLed>);
        expect(screen.getByText('ARM')).toBeInTheDocument();
        expect(container.firstChild).toHaveClass('text-[var(--color-accent-cyan)]');
    });
});
