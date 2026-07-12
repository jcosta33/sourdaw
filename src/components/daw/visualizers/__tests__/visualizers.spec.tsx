import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ADSREnvelope } from '../ADSREnvelope';
import { EQCurve } from '../EQCurve';

const eqProps = {
    lowGain: 0,
    lowFreq: 200,
    lowQ: 1,
    midGain: 0,
    midFreq: 1000,
    midQ: 1,
    highGain: 0,
    highFreq: 5000,
    highQ: 1,
};

const adsrProps = { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 };

describe('EQCurve', () => {
    it('renders without crash', () => {
        const { container } = render(<EQCurve {...eqProps} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts different gain values', () => {
        const { container } = render(<EQCurve {...eqProps} lowGain={6} midGain={-3} highGain={12} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts custom dimensions', () => {
        const { container } = render(<EQCurve {...eqProps} width={400} height={200} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts zero Q values', () => {
        const { container } = render(<EQCurve {...eqProps} lowQ={0.1} midQ={0.1} highQ={0.1} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts extreme frequencies', () => {
        const { container } = render(<EQCurve {...eqProps} lowFreq={20} midFreq={20} highFreq={20000} />);
        expect(container.firstChild).toBeTruthy();
    });
});

describe('ADSREnvelope', () => {
    it('renders without crash', () => {
        const { container } = render(<ADSREnvelope {...adsrProps} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts zero attack', () => {
        const { container } = render(<ADSREnvelope {...adsrProps} attack={0} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts zero sustain', () => {
        const { container } = render(<ADSREnvelope {...adsrProps} sustain={0} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts max values', () => {
        const { container } = render(<ADSREnvelope {...adsrProps} attack={2} decay={2} sustain={1} release={3} />);
        expect(container.firstChild).toBeTruthy();
    });
    it('accepts custom color and dimensions', () => {
        const { container } = render(<ADSREnvelope {...adsrProps} color="#ff0000" width={300} height={150} />);
        expect(container.firstChild).toBeTruthy();
    });
});
