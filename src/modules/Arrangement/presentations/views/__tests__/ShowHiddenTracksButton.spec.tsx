import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { ShowHiddenTracksButton } from '../ShowHiddenTracksButton';

function renderButton(props: { hiddenCount: number; pressed: boolean; onToggle?: () => void }) {
    return render(
        <TooltipProvider>
            <ShowHiddenTracksButton onToggle={() => undefined} {...props} />
        </TooltipProvider>
    );
}

describe('ShowHiddenTracksButton', () => {
    it('names the hidden track count and reflects the flag in aria-pressed', () => {
        renderButton({ hiddenCount: 2, pressed: true });

        const button = screen.getByRole('button', { name: 'Show hidden tracks (2)' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(button).toBeEnabled();
    });

    it('is not pressed while hidden tracks stay out', () => {
        renderButton({ hiddenCount: 1, pressed: false });

        expect(screen.getByRole('button', { name: 'Show hidden tracks (1)' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('is disabled when no track is hidden', () => {
        renderButton({ hiddenCount: 0, pressed: false });

        expect(screen.getByRole('button', { name: 'Show hidden tracks (0)' })).toBeDisabled();
    });

    it('calls onToggle on click', () => {
        const onToggle = vi.fn();
        renderButton({ hiddenCount: 1, pressed: false, onToggle });

        fireEvent.click(screen.getByRole('button', { name: 'Show hidden tracks (1)' }));

        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});
