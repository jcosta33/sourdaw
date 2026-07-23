import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { MidiSection } from '../MidiSection';

describe('MidiSection', () => {
    it('shows the current default velocity and MIDI input controls', () => {
        render(<MidiSection prefs={{ ...defaultPreferences, defaultVelocity: 100 }} update={vi.fn()} />);

        expect(screen.getByText('MIDI')).toBeInTheDocument();
        expect(screen.getByText('MIDI Input')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('calls update with the new value when the velocity slider changes', () => {
        const update = vi.fn();
        render(<MidiSection prefs={{ ...defaultPreferences, defaultVelocity: 100 }} update={update} />);

        const slider = screen.getByRole('slider', { name: 'Default MIDI velocity' });
        fireEvent.keyDown(slider, { key: 'ArrowRight' });

        expect(update).toHaveBeenCalledWith({ defaultVelocity: expect.any(Number) });
    });

    it('selects "All Channels" when midiInputChannel is "all"', () => {
        render(<MidiSection prefs={{ ...defaultPreferences, midiInputChannel: 'all' }} update={vi.fn()} />);

        const select = screen.getByRole('combobox', { name: 'MIDI input channel' }) as HTMLSelectElement;
        expect(select.value).toBe('all');
    });

    it('selects the numeric channel when midiInputChannel is a number', () => {
        render(<MidiSection prefs={{ ...defaultPreferences, midiInputChannel: 5 }} update={vi.fn()} />);

        const select = screen.getByRole('combobox', { name: 'MIDI input channel' }) as HTMLSelectElement;
        expect(select.value).toBe('5');
    });

    it('calls update with "all" when the All Channels option is chosen', () => {
        const update = vi.fn();
        render(<MidiSection prefs={{ ...defaultPreferences, midiInputChannel: 3 }} update={update} />);

        const select = screen.getByRole('combobox', { name: 'MIDI input channel' });
        fireEvent.change(select, { target: { value: 'all' } });

        expect(update).toHaveBeenCalledWith({ midiInputChannel: 'all' });
    });

    it('calls update with a numeric channel when a channel option is chosen', () => {
        const update = vi.fn();
        render(<MidiSection prefs={{ ...defaultPreferences, midiInputChannel: 'all' }} update={update} />);

        const select = screen.getByRole('combobox', { name: 'MIDI input channel' });
        fireEvent.change(select, { target: { value: '7' } });

        expect(update).toHaveBeenCalledWith({ midiInputChannel: 7 });
    });
});
