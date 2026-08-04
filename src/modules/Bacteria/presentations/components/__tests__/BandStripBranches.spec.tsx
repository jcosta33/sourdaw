import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
        <button type="button" data-testid="rotary-knob" onClick={() => onChange(value + 1)}>
            knob:{value}
        </button>
    ),
}));

import { BandStrip } from '../BandStrip';

import type { BacteriaBand } from '../../../models/BacteriaPatch';

function makeBand(overrides: Partial<BacteriaBand> = {}): BacteriaBand {
    return {
        gain: 0,
        solo: false,
        mute: false,
        distortionEnabled: false,
        filterEnabled: false,
        chorusEnabled: false,
        granularEnabled: false,
        spectralEnabled: false,
        freqShiftEnabled: false,
        phaserEnabled: false,
        lofiEnabled: false,
        convolutionEnabled: false,
        ...overrides,
    } as BacteriaBand;
}

function renderStrip(band: BacteriaBand, props: Record<string, unknown> = {}) {
    const onSelect = vi.fn();
    const onParamChange = vi.fn();
    render(
        <BandStrip
            index={0}
            band={band}
            isActive={false}
            onSelect={onSelect}
            onParamChange={onParamChange}
            {...props}
        />
    );
    return { onSelect, onParamChange };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('BandStrip — band label', () => {
    it('renders "Band N" with 1-based index', () => {
        render(<BandStrip index={2} band={makeBand()} isActive={false} onSelect={vi.fn()} onParamChange={vi.fn()} />);
        expect(screen.getByText('Band 3')).toBeInTheDocument();
    });
});

describe('BandStrip — solo toggle', () => {
    it('calls onParamChange("solo", 1) when S clicked and band.solo is false', () => {
        const { onParamChange, onSelect } = renderStrip(makeBand({ solo: false }));
        fireEvent.click(screen.getByText('S'));
        expect(onParamChange).toHaveBeenCalledWith('solo', 1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('calls onParamChange("solo", 0) when S clicked and band.solo is true', () => {
        const { onParamChange } = renderStrip(makeBand({ solo: true }));
        fireEvent.click(screen.getByText('S'));
        expect(onParamChange).toHaveBeenCalledWith('solo', 0);
    });
});

describe('BandStrip — mute toggle', () => {
    it('calls onParamChange("mute", 1) when M clicked and band.mute is false', () => {
        const { onParamChange, onSelect } = renderStrip(makeBand({ mute: false }));
        fireEvent.click(screen.getByText('M'));
        expect(onParamChange).toHaveBeenCalledWith('mute', 1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('calls onParamChange("mute", 0) when M clicked and band.mute is true', () => {
        const { onParamChange } = renderStrip(makeBand({ mute: true }));
        fireEvent.click(screen.getByText('M'));
        expect(onParamChange).toHaveBeenCalledWith('mute', 0);
    });
});

describe('BandStrip — effect indicators', () => {
    it('renders all 9 effect labels', () => {
        renderStrip(makeBand());
        const labels = ['DST', 'FLT', 'CHR', 'GRN', 'SPC', 'FSH', 'PHS', 'LFI', 'BDY'];
        for (const label of labels) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it('effect label text is present when enabled', () => {
        renderStrip(makeBand({ distortionEnabled: true }));
        expect(screen.getByText('DST')).toBeInTheDocument();
    });
});

describe('BandStrip — gain display', () => {
    it('shows gain with + prefix for positive values', () => {
        renderStrip(makeBand({ gain: 3.5 }));
        expect(screen.getByText('+3.5 dB')).toBeInTheDocument();
    });

    it('shows gain without + prefix for zero', () => {
        renderStrip(makeBand({ gain: 0 }));
        expect(screen.getByText('0.0 dB')).toBeInTheDocument();
    });

    it('shows gain without + prefix for negative values', () => {
        renderStrip(makeBand({ gain: -6 }));
        expect(screen.getByText('-6.0 dB')).toBeInTheDocument();
    });
});

describe('BandStrip — card click', () => {
    it('calls onSelect when card body is clicked', () => {
        const { onSelect } = renderStrip(makeBand());
        fireEvent.click(screen.getByText('Band 1'));
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});
