import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: vi.fn(() => ({
        frequencyBinCount: 1024,
        getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
        getFloatFrequencyData: vi.fn((arr: Float32Array) => arr.fill(-100)),
    })),
    getMasterStereoAnalysers: vi.fn(() => ({
        left: {
            fftSize: 256,
            frequencyBinCount: 128,
            getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
        },
        right: {
            fftSize: 256,
            frequencyBinCount: 128,
            getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
        },
    })),
    getTrackAnalyser: vi.fn(),
    getAudioSampleRate: vi.fn(() => 48000),
    PhaseCorrelationMeter: class {
        push() {}
        update() {}
        value = 0;
    },
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#4a7090'),
}));

import { Goniometer } from '../Goniometer';
import { Oscilloscope } from '../Oscilloscope';
import { PhaseCorrelationDisplay } from '../PhaseCorrelationDisplay';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Oscilloscope — canvas structure', () => {
    it('renders a canvas with aria-label "Oscilloscope"', () => {
        const { container } = render(<Oscilloscope />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('aria-label')).toBe('Oscilloscope');
    });

    it('default width/height', () => {
        const { container } = render(<Oscilloscope />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('width')).toBeTruthy();
        expect(canvas.getAttribute('height')).toBeTruthy();
    });

    it('custom dimensions', () => {
        const { container } = render(<Oscilloscope width={200} height={80} />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('width')).toBe('200');
    });
});

describe('Goniometer — canvas structure', () => {
    it('renders with role="img"', () => {
        render(<Goniometer />);
        expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('aria-label is "Stereo goniometer"', () => {
        render(<Goniometer />);
        expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Stereo goniometer');
    });
});

describe('PhaseCorrelationDisplay — meter structure', () => {
    it('renders with role="meter"', () => {
        render(<PhaseCorrelationDisplay />);
        expect(screen.getByRole('meter')).toBeInTheDocument();
    });

    it('aria-label is "Phase correlation meter"', () => {
        render(<PhaseCorrelationDisplay />);
        expect(screen.getByRole('meter')).toHaveAttribute('aria-label', 'Phase correlation meter');
    });

    it('aria-valuemin/max are set', () => {
        render(<PhaseCorrelationDisplay />);
        const meter = screen.getByRole('meter');
        expect(meter.getAttribute('aria-valuemin')).toBeTruthy();
        expect(meter.getAttribute('aria-valuemax')).toBeTruthy();
    });
});
