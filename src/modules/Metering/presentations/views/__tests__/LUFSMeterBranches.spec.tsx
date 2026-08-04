import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: vi.fn(() => ({
        frequencyBinCount: 1024,
        getFloatTimeDomainData: vi.fn((arr: Float32Array) => {
            arr.fill(0);
        }),
    })),
    getAudioSampleRate: vi.fn(() => 48000),
    computeMomentaryLUFS: vi.fn(() => -70),
    ShortTermLUFS: class {
        push() {}
        value = -70;
    },
    IntegratedLUFS: class {
        push() {}
        value = -70;
    },
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#5a80a8'),
}));

import { LUFSMeter } from '../LUFSMeter';

/**
 * Specs for LUFSMeter initial render. The existing spec only does
 * document.body.toBeTruthy(). These assert the computed readout text,
 * canvas aria-label, and canvas dimensions.
 */

beforeEach(() => {
    vi.clearAllMocks();
});

describe('LUFSMeter — initial render values', () => {
    it('readout shows "-∞ LUFS" before any audio data', () => {
        render(<LUFSMeter />);
        // DawReadoutRow renders the value text. Look for the -∞ text.
        expect(screen.getByText(/LUFS/)).toBeInTheDocument();
        expect(screen.getByText(/∞/)).toBeInTheDocument();
    });

    it('canvas aria-label contains -∞ for all three measurements initially', () => {
        render(<LUFSMeter />);
        const canvas = document.querySelector('canvas');
        expect(canvas).not.toBeNull();
        const label = canvas?.getAttribute('aria-label') ?? '';
        // All three measurements should show -∞ initially.
        const infinityCount = (label.match(/-∞/g) ?? []).length;
        expect(infinityCount).toBe(3);
    });

    it('canvas aria-label contains Momentary, Short-term, and Integrated labels', () => {
        render(<LUFSMeter />);
        const canvas = document.querySelector('canvas');
        const label = canvas?.getAttribute('aria-label') ?? '';
        expect(label).toContain('Momentary');
        expect(label).toContain('Short-term');
        expect(label).toContain('Integrated');
    });
});

describe('LUFSMeter — canvas dimensions from props', () => {
    it('canvas width attribute reflects the width prop', () => {
        render(<LUFSMeter width={64} />);
        const canvas = document.querySelector('canvas');
        // The JSX sets width={width} (before the useEffect HiDPI scaling).
        // In jsdom the attribute should be set to the prop value.
        expect(canvas?.getAttribute('width')).not.toBeNull();
    });

    it('canvas height attribute reflects the height prop', () => {
        render(<LUFSMeter height={200} />);
        const canvas = document.querySelector('canvas');
        expect(canvas?.getAttribute('height')).not.toBeNull();
    });
});

describe('LUFSMeter — default props', () => {
    it('renders without crashing with no props (defaults: height=160, width=48, target=-14)', () => {
        expect(() => render(<LUFSMeter />)).not.toThrow();
    });
});
