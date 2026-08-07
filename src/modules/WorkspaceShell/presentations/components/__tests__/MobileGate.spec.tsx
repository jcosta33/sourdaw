import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
        expect(screen.getByTestId('child')).toBeTruthy();
        expect(screen.queryByText(/This dough needs more room/)).toBeNull();
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
        expect(screen.queryByTestId('child')).toBeNull();
        expect(screen.getByText(/This dough needs more room/)).toBeTruthy();
    });
});

describe('MobileGate — mobile view content', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('max-width'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows Sourdaw branding text', () => {
        render(
            <MobileGate>
                <span />
            </MobileGate>
        );
        expect(screen.getByText('Sourdaw')).toBeTruthy();
        expect(screen.getByText('Desktop DAW')).toBeTruthy();
    });

    it('shows the full message about larger screens', () => {
        render(
            <MobileGate>
                <span />
            </MobileGate>
        );
        expect(screen.getByText(/larger screen/i)).toBeTruthy();
    });

    it('renders a Discord CTA button', () => {
        render(
            <MobileGate>
                <span />
            </MobileGate>
        );
        expect(screen.getByRole('button', { name: /discord/i })).toBeTruthy();
    });
});
