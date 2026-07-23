import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { PerformanceSection } from '../PerformanceSection';

describe('PerformanceSection', () => {
    it('shows the current buffer size, sample rate and computed latency', () => {
        render(
            <PerformanceSection
                prefs={{ ...defaultPreferences, bufferSize: 512, sampleRate: 44100 }}
                update={vi.fn()}
            />
        );

        const bufferSelect = screen.getByRole('combobox', { name: 'Buffer size' }) as HTMLSelectElement;
        const sampleRateSelect = screen.getByRole('combobox', { name: 'Sample rate' }) as HTMLSelectElement;

        expect(bufferSelect.value).toBe('512');
        expect(sampleRateSelect.value).toBe('44100');
        expect(screen.getByText('~11.6ms latency')).toBeInTheDocument();
    });

    it('recomputes latency when buffer size or sample rate prefs change', () => {
        render(
            <PerformanceSection
                prefs={{ ...defaultPreferences, bufferSize: 1024, sampleRate: 48000 }}
                update={vi.fn()}
            />
        );

        expect(screen.getByText('~21.3ms latency')).toBeInTheDocument();
    });

    it('calls update with the numeric buffer size when the buffer size select changes', () => {
        const update = vi.fn();
        render(<PerformanceSection prefs={{ ...defaultPreferences, bufferSize: 512 }} update={update} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Buffer size' }), { target: { value: '256' } });

        expect(update).toHaveBeenCalledWith({ bufferSize: 256 });
    });

    it('calls update with the numeric sample rate when the sample rate select changes', () => {
        const update = vi.fn();
        render(<PerformanceSection prefs={{ ...defaultPreferences, sampleRate: 44100 }} update={update} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Sample rate' }), { target: { value: '96000' } });

        expect(update).toHaveBeenCalledWith({ sampleRate: 96000 });
    });
});
