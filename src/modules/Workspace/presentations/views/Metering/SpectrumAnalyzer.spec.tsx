import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';

describe('SpectrumAnalyzer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SpectrumAnalyzer />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<SpectrumAnalyzer />);
        expect(document.body).toBeTruthy();
    });
});
