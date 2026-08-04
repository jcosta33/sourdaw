import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { PerformanceSection } from '../PerformanceSection';

describe('PerformanceSection', () => {
    it('shows the selected named audio profile and its restart boundary', () => {
        render(
            <PerformanceSection
                prefs={{ ...defaultPreferences, audioLatencyProfile: 'highCapacity' }}
                update={vi.fn()}
            />
        );

        const profileSelect = screen.getByRole('combobox', { name: 'Audio processing profile' }) as HTMLSelectElement;

        expect(profileSelect.value).toBe('highCapacity');
        expect(screen.getByText(/Takes effect after reloading Sourdaw\.$/)).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Buffer size' })).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Sample rate' })).not.toBeInTheDocument();
    });

    it('persists a high-capacity profile choice instead of a fictitious buffer size', () => {
        const update = vi.fn();
        render(
            <PerformanceSection prefs={{ ...defaultPreferences, audioLatencyProfile: 'lowLatency' }} update={update} />
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Audio processing profile' }), {
            target: { value: 'highCapacity' },
        });

        expect(update).toHaveBeenCalledWith({ audioLatencyProfile: 'highCapacity' });
    });

    it('does not persist an unknown select value', () => {
        const update = vi.fn();
        render(<PerformanceSection prefs={defaultPreferences} update={update} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Audio processing profile' }), {
            target: { value: 'turbo' },
        });

        expect(update).not.toHaveBeenCalled();
    });
});
