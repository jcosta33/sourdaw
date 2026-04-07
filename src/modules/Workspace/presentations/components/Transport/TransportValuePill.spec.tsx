import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransportValuePill } from './TransportValuePill';

describe('TransportValuePill', () => {
    it('should render children and handle click', () => {
        const onClick = vi.fn();
        render(
            <TransportValuePill onClick={onClick}>
                4
            </TransportValuePill>
        );
        fireEvent.click(screen.getByRole('button', { name: '4' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should support active styling', () => {
        render(
            <TransportValuePill active data-testid="pill">
                4
            </TransportValuePill>
        );
        expect(screen.getByTestId('pill')).toHaveClass('text-[var(--color-accent-cyan)]');
    });
});
