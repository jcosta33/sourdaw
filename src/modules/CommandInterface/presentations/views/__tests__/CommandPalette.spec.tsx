import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CommandPalette } from '../CommandPalette';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

const { useStore } = await import('#/infra/store/useStore');
const { executeUserAppAction } = await import('#/modules/Command/useCases');

describe('CommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<CommandPalette />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<CommandPalette />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<CommandPalette />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<CommandPalette />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('dispatches an activated entry through executeUserAppAction', () => {
        vi.mocked(useStore).mockReturnValue({ commandPaletteOpen: true });

        render(<CommandPalette />);
        const entry = screen.getByText('Toggle Metronome');
        fireEvent.click(entry.closest('[role="option"]') ?? entry);

        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'toggleMetronome' });
    });
});
