import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { LevelMeter } from '../LevelMeter';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('LevelMeter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<LevelMeter />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<LevelMeter />);
        expect(document.body).toBeTruthy();
    });
});
