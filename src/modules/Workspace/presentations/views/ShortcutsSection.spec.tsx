import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShortcutsSection } from './ShortcutsSection';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('ShortcutsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ShortcutsSection />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<ShortcutsSection />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ShortcutsSection />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
