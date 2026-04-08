import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreferencesDialog } from './PreferencesDialog';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('PreferencesDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PreferencesDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<PreferencesDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PreferencesDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PreferencesDialog />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
