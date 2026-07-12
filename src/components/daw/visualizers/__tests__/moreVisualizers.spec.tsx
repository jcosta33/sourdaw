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
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeupGain={3} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with no compression (ratio 1:1)', () => {
        const { container } = render(<CompressorCurve threshold={0} ratio={1} knee={0} makeupGain={0} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('DelayTaps', () => {
    it('renders with taps', () => {
        const { container } = render(
            <DelayTaps
                taps={[
                    { time: 0, gain: 1 },
                    { time: 0.25, gain: 0.5 },
                ]}
            />
        );
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with no taps', () => {
        const { container } = render(<DelayTaps taps={[]} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('DistortionCurve', () => {
    it('renders with drive', () => {
        const { container } = render(<DistortionCurve drive={0.5} tone={0.3} bias={0} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with extreme drive', () => {
        const { container } = render(<DistortionCurve drive={1} tone={1} bias={0.5} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('FilterResponse', () => {
    it('renders with lowpass filter', () => {
        const { container } = render(<FilterResponse cutoff={1000} resonance={1} type="lowpass" />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with highpass filter', () => {
        const { container } = render(<FilterResponse cutoff={500} resonance={5} type="highpass" />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('OscillatorWaveform', () => {
    it('renders sine wave', () => {
        const { container } = render(<OscillatorWaveform waveform="sine" frequency={440} pulseWidth={0.5} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders sawtooth wave', () => {
        const { container } = render(<OscillatorWaveform waveform="sawtooth" frequency={220} pulseWidth={0.5} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders square wave', () => {
        const { container } = render(<OscillatorWaveform waveform="square" frequency={110} pulseWidth={0.3} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('ReverbDecay', () => {
    it('renders with decay and damping', () => {
        const { container } = render(<ReverbDecay decay={2.5} damping={0.3} roomSize={0.8} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('renders with minimal decay', () => {
        const { container } = render(<ReverbDecay decay={0.1} damping={0.9} roomSize={0.1} />);
        expect(container.firstChild).toBeTruthy();
    });
});
