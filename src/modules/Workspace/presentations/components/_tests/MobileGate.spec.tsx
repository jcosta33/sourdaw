import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileGate } from '../MobileGate';

describe('MobileGate', () => {
    const originalInnerWidth = window.innerWidth;

    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    afterEach(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
        vi.restoreAllMocks();
    });

    it('should render children on wide viewports', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
        render(
            <MobileGate>
                <span data-testid="child">Desktop</span>
            </MobileGate>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
        expect(screen.queryByText(/This dough needs more room/)).not.toBeInTheDocument();
    });

    it('should show mobile message on narrow viewports', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('max-width'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        render(
            <MobileGate>
                <span data-testid="child">Hidden</span>
            </MobileGate>
        );
        expect(screen.queryByTestId('child')).not.toBeInTheDocument();
        expect(screen.getByText(/This dough needs more room/)).toBeInTheDocument();
    });
});
