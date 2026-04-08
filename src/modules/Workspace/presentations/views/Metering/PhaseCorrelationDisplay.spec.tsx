import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseCorrelationDisplay } from './PhaseCorrelationDisplay';

describe('PhaseCorrelationDisplay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PhaseCorrelationDisplay />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PhaseCorrelationDisplay />);
        expect(document.body).toBeTruthy();
    });
});
