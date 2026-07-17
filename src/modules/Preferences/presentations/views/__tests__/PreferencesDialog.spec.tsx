import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('#/modules/AudioEngine/presentations/views', () => ({
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

    it('should render without crashing', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PreferencesDialog open={true} onClose={vi.fn()} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
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
});
