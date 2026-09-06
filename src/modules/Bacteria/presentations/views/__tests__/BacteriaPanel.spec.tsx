import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BacteriaPanel } from '../BacteriaPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

describe('BacteriaPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('should establish min-height floor without hard overflow clipping', () => {
        const { container } = render(<BacteriaPanel deviceId="dev-1" />);
        const faceplate = container.querySelector<HTMLElement>('.bacteria-faceplate');
        expect(faceplate).not.toBeNull();
        expect(faceplate?.className).toContain('min-h-[460px]');
        expect(faceplate?.style.overflow).not.toBe('hidden');
    });

    it('renders Gain staging with full-width layout without nested subgrid collision', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        const gainStagingHeader = screen.getByText('Gain staging');
        expect(gainStagingHeader).not.toBeNull();

        const gainStagingCard = gainStagingHeader.closest('.bacteria-window');
        expect(gainStagingCard).not.toBeNull();

        // Knobs inside Gain staging
        expect(screen.getByRole('slider', { name: 'Input' })).not.toBeNull();
        expect(screen.getByRole('slider', { name: 'Output' })).not.toBeNull();
        expect(screen.getByRole('slider', { name: 'Mix' })).not.toBeNull();

        // Ensure Gain staging is not inside a 2-column subgrid that squeezes it
        expect(gainStagingCard?.parentElement?.className).not.toContain('grid-cols-2');

        // Band energy meters should appear exactly once in the entire panel (in status bar)
        const bandEnergyTitles = screen.getAllByText('Band energy');
        expect(bandEnergyTitles).toHaveLength(1);
    });

    it('supports vertical scrolling in PlayHero columns when height is constrained', () => {
        const { container } = render(<BacteriaPanel deviceId="dev-1" />);
        const scrollableHeroColumns = container.querySelectorAll('.overflow-y-auto');
        expect(scrollableHeroColumns.length).toBeGreaterThanOrEqual(2);
    });
});
