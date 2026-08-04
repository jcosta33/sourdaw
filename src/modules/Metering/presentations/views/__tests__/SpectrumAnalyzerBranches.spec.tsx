import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: vi.fn(() => ({
        frequencyBinCount: 1024,
        getFloatFrequencyData: vi.fn((arr: Float32Array) => arr.fill(-100)),
    })),
    getTrackAnalyser: vi.fn(),
    getAudioSampleRate: vi.fn(() => 48000),
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#4a7090'),
}));

import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SpectrumAnalyzer — canvas structure', () => {
    it('renders a canvas with role="img"', () => {
        render(<SpectrumAnalyzer />);
        expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('aria-label is "Spectrum analyzer"', () => {
        render(<SpectrumAnalyzer />);
        expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Spectrum analyzer');
    });

    it('default width/height are 300/120', () => {
        const { container } = render(<SpectrumAnalyzer />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('width')).toBe('300');
        expect(canvas.getAttribute('height')).toBe('120');
    });

    it('custom width/height reflect on canvas attributes', () => {
        const { container } = render(<SpectrumAnalyzer width={200} height={80} />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('width')).toBe('200');
        expect(canvas.getAttribute('height')).toBe('80');
    });
});

describe('SpectrumAnalyzer — default props', () => {
    it('renders without crashing with no props', () => {
        expect(() => render(<SpectrumAnalyzer />)).not.toThrow();
    });
});
