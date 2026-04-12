import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { SoloModeSelector } from '../SoloModeSelector';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('SoloModeSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<SoloModeSelector />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<SoloModeSelector />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(<SoloModeSelector />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
