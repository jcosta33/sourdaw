import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { AppearanceSection } from '../AppearanceSection';

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

    it('calls update with a scale fraction when the UI scale slider changes', () => {
        const update = vi.fn();
        render(<AppearanceSection prefs={{ ...defaultPreferences, uiScale: 1 }} update={update} />);

        const slider = screen.getByRole('slider', { name: 'UI Scale' });
        fireEvent.keyDown(slider, { key: 'ArrowRight' });

        expect(update).toHaveBeenCalledWith({ uiScale: expect.any(Number) });
    });
});
