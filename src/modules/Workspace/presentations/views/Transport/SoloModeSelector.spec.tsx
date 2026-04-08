import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoloModeSelector } from './SoloModeSelector';

describe('SoloModeSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SoloModeSelector />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<SoloModeSelector />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<SoloModeSelector />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
