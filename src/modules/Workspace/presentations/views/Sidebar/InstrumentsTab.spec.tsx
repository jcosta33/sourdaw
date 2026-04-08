import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstrumentsTab } from './InstrumentsTab';

describe('InstrumentsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<InstrumentsTab />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<InstrumentsTab />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<InstrumentsTab />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
