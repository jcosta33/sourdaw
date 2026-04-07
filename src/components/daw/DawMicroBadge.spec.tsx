import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawMicroBadge } from './DawMicroBadge';

describe('DawMicroBadge', () => {
    it('should render children with tone styles', () => {
        render(
            <DawMicroBadge tone="cyan" data-testid="badge">
                New
            </DawMicroBadge>
        );
        expect(screen.getByTestId('badge')).toHaveTextContent('New');
        expect(screen.getByTestId('badge')).toHaveClass('text-[var(--color-accent-cyan)]');
    });

    it('should use full rounding when rounded is full', () => {
        const { container } = render(<DawMicroBadge rounded="full">x</DawMicroBadge>);
        expect(container.firstChild).toHaveClass('rounded-full');
    });
});
