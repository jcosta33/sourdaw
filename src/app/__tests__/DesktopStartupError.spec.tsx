import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DesktopStartupError } from '../DesktopStartupError';

describe('DesktopStartupError', () => {
    it('explains the fatal desktop startup failure and offers reload recovery', () => {
        const reload = vi.fn();

        render(<DesktopStartupError onReload={reload} />);

        expect(screen.getByRole('alert')).toHaveAccessibleName('Sourdaw could not start');
        expect(screen.getByText(/desktop connection did not load/i)).toBeVisible();

        fireEvent.click(screen.getByRole('button', { name: 'Reload Sourdaw' }));

        expect(reload).toHaveBeenCalledOnce();
    });
});
