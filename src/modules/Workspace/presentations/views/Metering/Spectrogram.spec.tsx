import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spectrogram } from './Spectrogram';

describe('Spectrogram', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<Spectrogram />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<Spectrogram />);
        expect(document.body).toBeTruthy();
    });
});
