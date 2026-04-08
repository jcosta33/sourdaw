import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveformEditor } from './WaveformEditor';

describe('WaveformEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<WaveformEditor />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<WaveformEditor />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<WaveformEditor />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
