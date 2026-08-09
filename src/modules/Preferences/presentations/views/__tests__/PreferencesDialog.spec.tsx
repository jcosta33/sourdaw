import { fireEvent, render, screen, within } from '@testing-library/react';
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

    it('preserves the dialog shell and navigation layout contracts', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);

        const navigation = screen.getByRole('navigation');
        const sideRail = navigation.parentElement;
        const shell = sideRail?.parentElement;

        expect(shell?.tagName).toBe('DIV');
        expect(shell).toHaveClass(
            'flex',
            'flex-row',
            'min-w-0',
            'gap-0',
            'items-stretch',
            'justify-start',
            'h-[520px]'
        );
        expect(shell?.children).toHaveLength(2);
        expect(shell?.children[0]).toBe(sideRail);
        expect(shell?.children[1]).toHaveClass('flex-1', 'gap-5', 'bg-surface-base/60', 'p-5');

        expect(navigation.tagName).toBe('NAV');
        expect(navigation).toHaveClass(
            'flex',
            'flex-col',
            'min-h-0',
            'gap-0.5',
            'items-stretch',
            'justify-start',
            'h-full'
        );
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
});
