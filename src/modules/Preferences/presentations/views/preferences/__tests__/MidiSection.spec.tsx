import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { OBJECT_URL_LIFETIME_MS } from '#/utils/downloadFile';

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

    it('reaches real profile inspection and file import/export from the MIDI preferences entry', async () => {
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = vi.fn(() => 'blob:preferences-mappings');
            static revokeObjectURL = vi.fn();
        });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        try {
            render(<MidiSection prefs={{ ...defaultPreferences }} update={vi.fn()} />);
            expect(screen.getByRole('combobox', { name: 'Hardware profile' })).toHaveValue('push-2');
            expect(screen.getByRole('table', { name: 'Push 2 mappings' })).toBeInTheDocument();
            expect(screen.getByText('button 85')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Export mappings' }));
            const blob = vi.mocked(URL.createObjectURL).mock.lastCall?.[0];
            if (!(blob instanceof Blob)) {
                throw new Error('Expected the real mapping file download');
            }
            const original = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsText(blob);
            });
            const file = new File([original.replace('"controlIndex": 85', '"controlIndex": 86')], 'mapping.json');
            // The production repository still reads the File; jsdom needs its browser text method supplied.
            Object.defineProperty(file, 'text', {
                value: () => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsText(file);
                }),
            });
            fireEvent.change(screen.getByLabelText('Mapping JSON file'), { target: { files: [file] } });
            await waitFor(() => expect(screen.getByText('button 86')).toBeInTheDocument());
            const originalFile = new File([original], 'original.json');
            Object.defineProperty(originalFile, 'text', { value: () => Promise.resolve(original) });
            fireEvent.change(screen.getByLabelText('Mapping JSON file'), { target: { files: [originalFile] } });
            await waitFor(() => expect(screen.getByText('button 85')).toBeInTheDocument());
        } finally {
            try {
                await waitFor(() => expect(document.querySelector('a[download]')).toBeNull(), {
                    timeout: OBJECT_URL_LIFETIME_MS * 2,
                });
            } finally {
                vi.restoreAllMocks();
                vi.unstubAllGlobals();
            }
        }
    });
});
