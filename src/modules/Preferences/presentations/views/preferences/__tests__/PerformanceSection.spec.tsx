import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { PerformanceSection } from '../PerformanceSection';

describe('PerformanceSection', () => {
    it('shows the selected latency profile and honest Chrome runtime guidance', () => {
        render(
            <PerformanceSection
                prefs={{ ...defaultPreferences, audioLatencyProfile: 'high-capacity' }}
                update={vi.fn()}
            />
        );

        expect(screen.getByRole('combobox', { name: 'Audio latency profile' })).toHaveValue('high-capacity');
        expect(screen.getByText(/Chrome chooses the actual buffer size and sample rate/i)).toBeInTheDocument();
        expect(screen.getByText(/takes effect after reload/i)).toBeInTheDocument();
    });

    it('updates the named profile without exposing fake buffer or sample-rate controls', () => {
        const update = vi.fn();
        render(<PerformanceSection prefs={defaultPreferences} update={update} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Audio latency profile' }), {
            target: { value: 'high-capacity' },
        });

        expect(update).toHaveBeenCalledWith({ audioLatencyProfile: 'high-capacity' });
        expect(screen.queryByRole('combobox', { name: 'Buffer size' })).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Sample rate' })).not.toBeInTheDocument();
    });
});
