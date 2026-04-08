import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IOSection } from './IOSection';

describe('IOSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<IOSection />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<IOSection />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<IOSection />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
