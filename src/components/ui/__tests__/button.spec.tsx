import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../button';

describe('Button', () => {
    it('should render as a button with default data attributes', () => {
        render(<Button type="button">Save</Button>);
        const button = screen.getByRole('button', { name: 'Save' });
        expect(button).toHaveAttribute('data-slot', 'button');
        expect(button).toHaveAttribute('data-variant', 'default');
        expect(button).toHaveAttribute('data-size', 'default');
    });

    it('should apply variant and size data attributes', () => {
        render(
            <Button type="button" variant="destructive" size="sm">
                Delete
            </Button>
        );
        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('data-variant', 'destructive');
        expect(button).toHaveAttribute('data-size', 'sm');
    });

    it('should forward click handlers', () => {
        const onClick = vi.fn();
        render(
            <Button type="button" onClick={onClick}>
                Tap
            </Button>
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
