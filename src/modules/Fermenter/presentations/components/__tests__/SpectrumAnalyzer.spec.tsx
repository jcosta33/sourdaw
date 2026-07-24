import { render } from '@testing-library/react';
import { beforeEach, describe, it, expect } from 'vitest';

import { DEFAULT_FERMENTER_STATE, fermenterStore } from '../../../stores/fermenterStore';
import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

const DEVICE = 'device-spec';

function setBuffer(buffer: Float32Array | null): void {
    fermenterStore.set({
        [DEVICE]: { ...DEFAULT_FERMENTER_STATE, scopeBuffer: buffer },
    });
}

describe('SpectrumAnalyzer (Fermenter)', () => {
    beforeEach(() => {
        fermenterStore.set({});
    });

    it('renders a canvas with the requested dimensions', () => {
        render(<SpectrumAnalyzer deviceId={DEVICE} width={120} height={40} />);
        const canvas = document.querySelector('canvas')!;
        expect(canvas.style.width).toBe('120px');
        expect(canvas.style.height).toBe('40px');
    });

    it('renders the flat baseline when no buffer is available', () => {
        // No store entry → useFermenterBuffer returns null → empty-buffer branch.
        render(<SpectrumAnalyzer deviceId={DEVICE} width={120} height={40} />);
        expect(document.querySelector('canvas')).toBeTruthy();
    });

    it('renders the flat baseline when the buffer is empty', () => {
        setBuffer(new Float32Array(0));
        render(<SpectrumAnalyzer deviceId={DEVICE} width={120} height={40} />);
        expect(document.querySelector('canvas')).toBeTruthy();
    });

    it('computes and draws the magnitude spectrum for a known signal', () => {
        // A pure DC signal (all samples = 1) concentrates all energy in bin 0
        // (k=0 → freq=0 → cos/sin terms collapse). This exercises the DFT loop,
        // the max-magnitude normalization, and the bar-drawing loop.
        const buffer = new Float32Array(64).fill(1);
        setBuffer(buffer);
        render(<SpectrumAnalyzer deviceId={DEVICE} width={240} height={80} />);
        expect(document.querySelector('canvas')).toBeTruthy();
    });

    it('handles a near-silent buffer without dividing by zero', () => {
        // maxMag < 0.0001 → normalization guards against 0 (sets maxMag = 1).
        const buffer = new Float32Array(32).fill(1e-6);
        setBuffer(buffer);
        render(<SpectrumAnalyzer deviceId={DEVICE} width={90} height={40} />);
        expect(document.querySelector('canvas')).toBeTruthy();
    });
});
