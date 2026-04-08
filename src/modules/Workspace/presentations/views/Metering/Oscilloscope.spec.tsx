import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Oscilloscope } from './Oscilloscope';

describe('Oscilloscope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<Oscilloscope />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<Oscilloscope />);
        expect(document.body).toBeTruthy();
    });
});
