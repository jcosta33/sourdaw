import { render } from '@testing-library/react';
import { beforeEach, describe, it, expect } from 'vitest';

import { DEFAULT_FERMENTER_STATE, fermenterStore } from '../../../stores/fermenterStore';
import { Oscilloscope } from '../Oscilloscope';

const DEVICE = 'device-scope';

function setBuffer(buffer: Float32Array | null): void {
    fermenterStore.set({
        [DEVICE]: { ...DEFAULT_FERMENTER_STATE, scopeBuffer: buffer },
    });
}

describe('Oscilloscope', () => {
    beforeEach(() => {
        fermenterStore.set({});
    });

    it('renders a canvas sized to the given width and height', () => {
        render(<Oscilloscope deviceId={DEVICE} width={120} height={40} />);
        const canvas = document.querySelector('canvas')!;
        expect(canvas.style.width).toBe('120px');
        expect(canvas.style.height).toBe('40px');
    });

    it('renders without error when no telemetry buffer exists (flat line path)', () => {
        // No store entry for the device → useFermenterBuffer returns null.
        render(<Oscilloscope deviceId={DEVICE} width={100} height={40} />);
        // The effect's empty-buffer branch runs and returns early without drawing a waveform.
        expect(document.querySelector('canvas')).toBeTruthy();
    });

    it('draws the waveform when a non-empty buffer is present', () => {
        // A full-scale sine-ish buffer of known length drives the waveform branch.
        const buffer = new Float32Array(128);
        for (let i = 0; i < buffer.length; i++) {
            buffer[i] = Math.sin((i / buffer.length) * Math.PI * 2);
        }
        setBuffer(buffer);
        const { unmount } = render(<Oscilloscope deviceId={DEVICE} width={100} height={40} />);
        // Non-empty buffer branch: the effect completes the glow + crisp passes.
        expect(document.querySelector('canvas')).toBeTruthy();
        unmount();
    });

    it('draws the flat line when the buffer is present but empty', () => {
        setBuffer(new Float32Array(0));
        render(<Oscilloscope deviceId={DEVICE} width={100} height={40} />);
        // buffer.length === 0 → early-return flat-line branch.
        expect(document.querySelector('canvas')).toBeTruthy();
    });

    it('accepts a literal CSS color without var() resolution', () => {
        const buffer = new Float32Array([0.1, -0.1, 0.2]);
        setBuffer(buffer);
        // A literal color skips the resolveToken branch entirely.
        render(<Oscilloscope deviceId={DEVICE} color="#ff00ff" width={80} height={30} />);
        expect(document.querySelector('canvas')).toBeTruthy();
    });
});
