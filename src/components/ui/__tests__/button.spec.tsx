import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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

    it('should apply bare variant and size without the default surface', () => {
        render(
            <Button type="button" variant="bare" size="bare" className="text-[7px]">
                Close
            </Button>
        );
        const button = screen.getByRole('button', { name: 'Close' });
        expect(button).toHaveAttribute('data-variant', 'bare');
        expect(button).toHaveAttribute('data-size', 'bare');
        expect(button.className).toContain('text-[7px]');
        expect(button.className).not.toContain('daw-panel-surface');
    });

    it('should forward an explicit menuitem role', () => {
        render(
            <Button type="button" variant="bare" size="bare" role="menuitem">
                New Project
            </Button>
        );
        expect(screen.getByRole('menuitem', { name: /New Project/i })).toBeTruthy();
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
