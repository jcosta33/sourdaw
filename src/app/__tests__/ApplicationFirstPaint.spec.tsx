import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationFirstPaint } from '../ApplicationFirstPaint';

describe('ApplicationFirstPaint', () => {
    it('carries a readable terminal failure view with an explicit manual reload', () => {
        const reload = vi.fn();
        render(<ApplicationFirstPaint onReload={reload} />);
        expect(screen.getByRole('alert')).toHaveAccessibleName('Sourdaw could not start');
        expect(screen.getByText('The application did not finish loading. Reload Sourdaw to try again.')).toBeVisible();
        expect(reload).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reload Sourdaw' }));
        expect(reload).toHaveBeenCalledOnce();
    });

    it('exposes the app-shell marker at viewport size before the full application loads', () => {
        render(<ApplicationFirstPaint />);

        const shell = screen.getByTestId('app-shell');
        expect(shell).toHaveClass('h-screen', 'w-screen', 'overflow-hidden', 'bg-surface-app');
        expect(shell.style.width).toBe('100vw');
        expect(shell.style.height).toBe('100vh');
        expect(shell.style.overflow).toBe('hidden');
    });
});
