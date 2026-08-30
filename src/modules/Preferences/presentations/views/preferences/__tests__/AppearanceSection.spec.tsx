import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { AppearanceSection } from '../AppearanceSection';

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        onValueCommit,
        max,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (values: number[]) => void;
        onValueCommit?: (values: number[]) => void;
        max?: number;
        'aria-label'?: string;
    }) => (
        <>
            <input
                type="range"
                aria-label={ariaLabel}
                value={value[0]}
                max={max}
                onChange={(event) => onValueChange([Number(event.target.value)])}
            />
            <button type="button" onClick={() => onValueCommit?.(value)}>
                Commit UI Scale
            </button>
        </>
    ),
}));

describe('AppearanceSection', () => {
    beforeEach(() => {
        document.documentElement.classList.remove('dark', 'light');
    });

    it('marks the active theme button as selected', () => {
        render(<AppearanceSection prefs={{ ...defaultPreferences, theme: 'dark' }} update={vi.fn()} />);

        expect(screen.getByRole('button', { name: /dark/i })).toHaveAttribute('data-variant', 'secondary');
        expect(screen.getByRole('button', { name: /light/i })).toHaveAttribute('data-variant', 'outline');
    });

    it('calls update with the clicked theme and toggles the root classList', () => {
        const update = vi.fn();
        render(<AppearanceSection prefs={{ ...defaultPreferences, theme: 'dark' }} update={update} />);

        fireEvent.click(screen.getByRole('button', { name: /light/i }));

        expect(update).toHaveBeenCalledWith({ theme: 'light' });
        expect(document.documentElement.classList.contains('light')).toBe(true);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('reflects colorblindMode in the ToggleRow and calls update on toggle', () => {
        const update = vi.fn();
        render(<AppearanceSection prefs={{ ...defaultPreferences, colorblindMode: false }} update={update} />);

        const toggle = screen.getByRole('switch');
        expect(toggle).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(toggle);

        expect(update).toHaveBeenCalledWith({ colorblindMode: true });
    });

    it('shows the current UI scale as a rounded percentage', () => {
        render(<AppearanceSection prefs={{ ...defaultPreferences, uiScale: 1.25 }} update={vi.fn()} />);

        expect(screen.getByText('125%')).toBeInTheDocument();
    });

    it('keeps UI scale changes local until the slider gesture commits', () => {
        const update = vi.fn();
        render(<AppearanceSection prefs={{ ...defaultPreferences, uiScale: 1 }} update={update} />);

        const slider = screen.getByRole('slider', { name: 'UI Scale' });
        fireEvent.change(slider, { target: { value: '125' } });

        expect(screen.getByText('125%')).toBeInTheDocument();
        expect(update).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Commit UI Scale' }));

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({ uiScale: 1.25 });
    });

    it('syncs the local UI scale draft when preferences change externally', () => {
        const update = vi.fn();
        const { rerender } = render(
            <AppearanceSection prefs={{ ...defaultPreferences, uiScale: 1 }} update={update} />
        );

        fireEvent.change(screen.getByRole('slider', { name: 'UI Scale' }), { target: { value: '125' } });
        rerender(<AppearanceSection prefs={{ ...defaultPreferences, uiScale: 1.5 }} update={update} />);

        expect(screen.getByRole('slider', { name: 'UI Scale' })).toHaveValue('150');
        expect(screen.getByText('150%')).toBeInTheDocument();
        expect(update).not.toHaveBeenCalled();
    });
});
