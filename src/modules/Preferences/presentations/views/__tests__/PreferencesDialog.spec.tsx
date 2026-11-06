import { useState } from 'react';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PreferencesDialog } from '../PreferencesDialog';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
    preferencesStoreSet: vi.fn(),
    updatePreferences: vi.fn(),
    resetPreferences: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

// Spread `importOriginal`: this mock already omitted `MidiDevicePicker`, which
// `MidiSection` (rendered from this dialog) imports from the same barrel. It only
// stayed green because no test in this file opens that section — mount it, or add
// another view to the barrel, and every render here reds on `undefined` (#1393).
vi.mock('#/modules/AudioEngine/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/presentations/views')>()),
    AudioDevicePicker: () => <div data-testid="audio-device-picker" />,
    PluginScanSettings: () => <div data-testid="plugin-scan-settings" />,
}));

vi.mock('../../../stores/preferencesStore', () => ({
    preferencesStore: {
        set: mocks.preferencesStoreSet,
        subscribe: vi.fn(() => () => {}),
    },
}));

vi.mock('../../../useCases/updatePreferences', () => ({
    updatePreferences: mocks.updatePreferences,
}));

vi.mock('../../../useCases/resetPreferences', () => ({
    resetPreferences: mocks.resetPreferences,
}));

vi.mock('../preferences/GeneralSection', () => ({
    GeneralSection: ({ update }: { update: (partial: { soloMode: 'pfl' }) => void }) => (
        <button type="button" onClick={() => update({ soloMode: 'pfl' })}>
            Change solo mode
        </button>
    ),
}));

describe('PreferencesDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens on the requested section each time it opens, and keeps the last one when none is requested', () => {
        const { rerender } = render(<PreferencesDialog open={false} onClose={vi.fn()} requestedSection="audio" />);
        expect(screen.queryByTestId('audio-device-picker')).not.toBeInTheDocument();

        rerender(<PreferencesDialog open={true} onClose={vi.fn()} requestedSection="audio" />);
        expect(screen.getByTestId('audio-device-picker')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'General' }));
        expect(screen.queryByTestId('audio-device-picker')).not.toBeInTheDocument();

        rerender(<PreferencesDialog open={false} onClose={vi.fn()} />);
        rerender(<PreferencesDialog open={true} onClose={vi.fn()} />);
        expect(screen.queryByTestId('audio-device-picker')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change solo mode' })).toBeInTheDocument();
    });

    it('preserves the dialog shell and navigation layout contracts', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        const navigation = screen.getByRole('navigation', { name: 'Preferences sections' });
        expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
        const sideRail = navigation.parentElement;
        const shell = sideRail?.parentElement;

        expect(dialog).toHaveClass(
            'h-[680px]',
            'max-h-[calc(100dvh-4rem)]',
            'w-[920px]',
            'max-w-[calc(100vw-4rem)]',
            'overflow-hidden'
        );
        expect(shell?.tagName).toBe('DIV');
        expect(shell).toHaveClass(
            'flex',
            'flex-row',
            'min-w-0',
            'gap-0',
            'items-stretch',
            'justify-start',
            'h-full',
            'min-h-0',
            'overflow-hidden'
        );
        expect(shell?.children).toHaveLength(2);
        expect(shell?.children[0]).toBe(sideRail);
        expect(shell?.children[1]).toHaveClass('flex-1', 'gap-5', 'bg-surface-base/60', 'p-5', '[&>*]:shrink-0');
        expect(sideRail).toHaveClass('overflow-y-auto');

        expect(navigation.tagName).toBe('NAV');
        expect(navigation).toHaveClass(
            'flex',
            'flex-col',
            'gap-0.5',
            'items-stretch',
            'justify-start',
            'h-max',
            'min-h-full'
        );
        expect(navigation).not.toHaveClass('h-full');
    });

    it('preserves navigation content and focus order', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);

        const navigation = screen.getByRole('navigation');
        const buttons = within(navigation).getAllByRole('button');

        expect(buttons.map((button) => button.textContent.trim())).toEqual([
            'General',
            'Appearance',
            'Layout',
            'Audio',
            'MIDI',
            'Performance',
            'AI',
            'Shortcuts',
            'Reset Defaults',
            'Done',
        ]);
        expect(buttons.every((button) => button.tagName === 'BUTTON')).toBe(true);
        expect(buttons.slice(0, 8).every((button) => button.getAttribute('type') === 'button')).toBe(true);
        expect(buttons.slice(0, 8).every((button) => button.classList.contains('justify-start'))).toBe(true);
        expect(Array.from(navigation.children).slice(1, 9)).toEqual(buttons.slice(0, 8));
    });

    it('switches sections through a keyboard-synthesized native-button click', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);

        const audioButton = screen.getByRole('button', { name: 'Audio' });
        audioButton.focus();
        fireEvent.click(audioButton, { detail: 0 });

        expect(audioButton).toHaveFocus();
        expect(screen.getByTestId('audio-device-picker')).toBeInTheDocument();
        expect(screen.getByTestId('plugin-scan-settings')).toBeInTheDocument();
    });

    it('should route preference updates through the Workspace update use case', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Change solo mode' }));

        expect(mocks.updatePreferences).toHaveBeenCalledWith({ patch: { soloMode: 'pfl' } });
        expect(mocks.preferencesStoreSet).not.toHaveBeenCalled();
    });

    it('should route reset defaults through the Workspace reset use case', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset Defaults' }));

        expect(mocks.resetPreferences).toHaveBeenCalledWith();
        expect(mocks.preferencesStoreSet).not.toHaveBeenCalled();
    });

    it('closes from Done and the dialog Escape interaction', () => {
        const onClose = vi.fn();
        const { rerender } = render(<PreferencesDialog open={true} onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(<PreferencesDialog open={true} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('returns focus to the control that opened it after Escape', async () => {
        const Host = () => {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Open Preferences
                    </button>
                    <PreferencesDialog open={open} onClose={() => setOpen(false)} />
                </>
            );
        };
        render(<Host />);
        const opener = screen.getByRole('button', { name: 'Open Preferences' });
        opener.focus();
        fireEvent.click(opener);
        const dialog = await screen.findByRole('dialog');

        fireEvent.keyDown(dialog, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(opener).toHaveFocus();
        });
    });
});
