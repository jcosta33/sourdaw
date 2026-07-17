import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CompressorCurve } from '../CompressorCurve';
import { DelayTaps } from '../DelayTaps';
import { DistortionCurve } from '../DistortionCurve';
import { FilterResponse } from '../FilterResponse';
import { OscillatorWaveform } from '../OscillatorWaveform';
import { ReverbDecay } from '../ReverbDecay';

describe('CompressorCurve', () => {
    it('renders with threshold and ratio', () => {
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={3} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with no compression (ratio 1:1)', () => {
        const { container } = render(<CompressorCurve threshold={0} ratio={1} knee={0} makeup={0} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('DelayTaps', () => {
    it('renders with typical delay settings', () => {
        const { container } = render(<DelayTaps time={250} feedback={0.5} mix={0.5} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with zeroed delay settings', () => {
        const { container } = render(<DelayTaps time={0} feedback={0} mix={0} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('DistortionCurve', () => {
    it('renders with drive', () => {
        const { container } = render(<DistortionCurve drive={50} tone={2000} mix={0.5} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with extreme drive', () => {
        const { container } = render(<DistortionCurve drive={100} tone={8000} mix={1} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('FilterResponse', () => {
    it('renders with lowpass filter', () => {
        const { container } = render(<FilterResponse cutoff={1000} resonance={1} filterType={0} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with highpass filter', () => {
        const { container } = render(<FilterResponse cutoff={500} resonance={5} filterType={1} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('OscillatorWaveform', () => {
    it('renders sine wave', () => {
        const { container } = render(<OscillatorWaveform waveform="sine" />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders sawtooth wave', () => {
        const { container } = render(<OscillatorWaveform waveform="sawtooth" />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders square wave', () => {
        const { container } = render(<OscillatorWaveform waveform="square" />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('ReverbDecay', () => {
    it('renders with decay and damping', () => {
        const { container } = render(<ReverbDecay size={0.8} decay={2.5} damping={0.3} predelay={20} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with minimal decay', () => {
        const { container } = render(<ReverbDecay size={0.1} decay={0.1} damping={0.9} predelay={0} />);
        expect(container.firstChild).toBeTruthy();
    });
});
