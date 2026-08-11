import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { GeneralSection } from '../GeneralSection';

describe('GeneralSection', () => {
    it('marks the active track height as selected and calls update on click', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, trackHeight: 'compact' }} update={update} />);

        expect(screen.getByRole('button', { name: 'compact' })).toHaveAttribute('data-variant', 'secondary');
        expect(screen.getByRole('button', { name: 'normal' })).toHaveAttribute('data-variant', 'outline');

        fireEvent.click(screen.getByRole('button', { name: 'large' }));

        expect(update).toHaveBeenCalledWith({ trackHeight: 'large' });
    });

    it('calls update when a grid snap option is clicked', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, gridSubdivision: '1/4' }} update={update} />);

        fireEvent.click(screen.getByRole('button', { name: '1/8' }));

        expect(update).toHaveBeenCalledWith({ gridSubdivision: '1/8' });
    });

    it('toggles Snap to Grid, Snap to Zero Crossing, Auto Save and Show Minimap', () => {
        const update = vi.fn();
        render(
            <GeneralSection
                prefs={{
                    ...defaultPreferences,
                    snapToGrid: true,
                    snapToZeroCrossing: false,
                    autoSave: true,
                    showMinimap: false,
                }}
                update={update}
            />
        );

        const switches = screen.getAllByRole('switch');
        expect(switches[0]!).toHaveAttribute('aria-checked', 'true');
        expect(switches[1]!).toHaveAttribute('aria-checked', 'false');
        expect(switches[2]!).toHaveAttribute('aria-checked', 'true');
        expect(switches[3]!).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(switches[0]!);
        expect(update).toHaveBeenCalledWith({ snapToGrid: false });

        fireEvent.click(switches[1]!);
        expect(update).toHaveBeenCalledWith({ snapToZeroCrossing: true });

        fireEvent.click(switches[2]!);
        expect(update).toHaveBeenCalledWith({ autoSave: false });

        fireEvent.click(switches[3]!);
        expect(update).toHaveBeenCalledWith({ showMinimap: true });
    });

    it('configures the autosave interval and explains that crash recovery remains active', () => {
        const update = vi.fn();
        render(
            <GeneralSection
                prefs={{ ...defaultPreferences, autoSave: true, autoSaveIntervalMs: 30_000 }}
                update={update}
            />
        );

        expect(screen.getByText(/crash-recovery data still updates/i)).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Auto-save interval' }), {
            target: { value: '60000' },
        });

        expect(update).toHaveBeenCalledWith({ autoSaveIntervalMs: 60_000 });
    });

    it('hides the metronome volume slider when the metronome is disabled', () => {
        render(<GeneralSection prefs={{ ...defaultPreferences, metronomeEnabled: false }} update={vi.fn()} />);

        expect(screen.queryByRole('slider', { name: 'Metronome volume' })).not.toBeInTheDocument();
    });

    it('shows and drives the metronome volume slider when the metronome is enabled', () => {
        const update = vi.fn();
        render(
            <GeneralSection
                prefs={{ ...defaultPreferences, metronomeEnabled: true, metronomeVolume: 0.5 }}
                update={update}
            />
        );

        const slider = screen.getByRole('slider', { name: 'Metronome volume' });
        fireEvent.keyDown(slider, { key: 'ArrowRight' });

        expect(update).toHaveBeenCalledWith({ metronomeVolume: expect.any(Number) });
    });

    it('toggles the metronome enabled switch', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, metronomeEnabled: false }} update={update} />);

        const enabledSwitch = (screen.getByText('Enabled').parentElement as HTMLElement).querySelector(
            'button[role="switch"]'
        ) as HTMLElement;
        fireEvent.click(enabledSwitch);

        expect(update).toHaveBeenCalledWith({ metronomeEnabled: true });
    });

    it('marks the active count-in and calls update with the clicked bar count', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, recordCountIn: 1 }} update={update} />);

        const countInRow = screen.getByText('Count-In (bars)').parentElement as HTMLElement;
        const countInButtons = Array.from(countInRow.querySelectorAll('button'));
        const findCountIn = (label: string): HTMLElement | undefined =>
            countInButtons.find((button) => button.textContent === label);

        expect(findCountIn('1')).toHaveAttribute('data-variant', 'secondary');
        expect(findCountIn('Off')).toHaveAttribute('data-variant', 'ghost');

        fireEvent.click(findCountIn('4') as HTMLElement);

        expect(update).toHaveBeenCalledWith({ recordCountIn: 4 });
    });

    it('hides the pre-roll bars when pre-roll is disabled and toggles it on', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, preRollEnabled: false }} update={update} />);

        const preRollRow = screen.getByText('Pre-roll').closest('div') as HTMLElement;
        const toggleButton = preRollRow.querySelector('button') as HTMLElement;
        expect(toggleButton).toHaveTextContent('Off');
        expect(screen.queryByText('Pre-roll bars')).not.toBeInTheDocument();

        fireEvent.click(toggleButton);

        expect(update).toHaveBeenCalledWith({ preRollEnabled: true });
    });

    it('shows the pre-roll bars and calls update with the clicked bar count when pre-roll is enabled', () => {
        const update = vi.fn();
        render(
            <GeneralSection prefs={{ ...defaultPreferences, preRollEnabled: true, preRollBars: 2 }} update={update} />
        );

        const barsRow = screen.getByText('Pre-roll bars').parentElement as HTMLElement;
        const barButtons = Array.from(barsRow.querySelectorAll('button'));
        const findBar = (label: string): HTMLElement | undefined =>
            barButtons.find((button) => button.textContent === label);

        expect(findBar('2')).toHaveAttribute('data-variant', 'secondary');

        fireEvent.click(findBar('4') as HTMLElement);

        expect(update).toHaveBeenCalledWith({ preRollBars: 4 });
    });

    it('marks the active solo mode and calls update with the clicked mode', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, soloMode: 'sip' }} update={update} />);

        expect(screen.getByRole('button', { name: 'SIP' })).toHaveAttribute('data-variant', 'secondary');
        expect(screen.getByRole('button', { name: 'AFL' })).toHaveAttribute('data-variant', 'ghost');

        fireEvent.click(screen.getByRole('button', { name: 'PFL' }));

        expect(update).toHaveBeenCalledWith({ soloMode: 'pfl' });
    });

    it('renders the current voice command key and calls update after a captured keypress', () => {
        const update = vi.fn();
        render(<GeneralSection prefs={{ ...defaultPreferences, voiceCommandKey: 'v' }} update={update} />);

        expect(screen.getByText('V')).toBeInTheDocument();

        fireEvent.click(screen.getByText('V'));
        fireEvent.keyDown(window, { key: 'k' });

        expect(update).toHaveBeenCalledWith({ voiceCommandKey: 'k' });
    });
});
