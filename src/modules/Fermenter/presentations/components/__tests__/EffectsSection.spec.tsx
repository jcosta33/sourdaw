import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { DEFAULT_PATCH as F } from '../../../models/FermenterPatch';
import { EffectsSection } from '../EffectsSection';

// Test-only Knob: surfaces paramId + value and invokes onChange on click, so we
// can assert the section's param→callback routing without the real drag logic.
function TestKnob({
    paramId,
    value,
    onChange,
    label,
}: {
    paramId?: string;
    value: number;
    onChange: (v: number) => void;
    label?: string;
}): ReactElement {
    return (
        <button
            type="button"
            data-testid="knob"
            data-paramid={paramId}
            data-value={value}
            onClick={() => onChange(0.9)}
        >
            {label ?? 'knob'}
        </button>
    );
}

const knob = TestKnob as unknown as RotaryKnobComponent;

function baseProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        reverbType: F.reverbType,
        reverbMix: F.reverbMix,
        reverbDecay: F.reverbDecay,
        delayTime: F.delayTime,
        delayFeedback: F.delayFeedback,
        delayMix: F.delayMix,
        chorusRate: F.chorusRate,
        chorusDepth: F.chorusDepth,
        chorusMix: F.chorusMix,
        phaserRate: F.phaserRate,
        phaserDepth: F.phaserDepth,
        phaserMix: F.phaserMix,
        distDrive: F.distDrive,
        distTone: F.distTone,
        distMix: F.distMix,
        compThreshold: F.compThreshold,
        compRatio: F.compRatio,
        compAttack: F.compAttack,
        compRelease: F.compRelease,
        compMix: F.compMix,
        stereoWidth: F.stereoWidth,
        masterGain: F.masterGain,
        eqLowFreq: F.eqLowFreq,
        eqLowGain: F.eqLowGain,
        eqLowQ: F.eqLowQ,
        eqMidFreq: F.eqMidFreq,
        eqMidGain: F.eqMidGain,
        eqMidQ: F.eqMidQ,
        eqHighFreq: F.eqHighFreq,
        eqHighGain: F.eqHighGain,
        eqHighQ: F.eqHighQ,
        onParam: vi.fn(),
        ...overrides,
    };
}

function renderSection(overrides: Record<string, unknown> = {}) {
    const onParam = overrides.onParam ?? vi.fn();
    const props = { ...baseProps({ ...overrides, onParam }) };
    return { onParam, ...render(<EffectsSection {...props} />) };
}

/** Select a sub-tab by label and return all knobs rendered afterwards. */
function selectTab(label: string): HTMLElement[] {
    fireEvent.click(screen.getByText(label));
    return screen.getAllByTestId('knob');
}

function knobByParamId(knobs: HTMLElement[], paramId: string): HTMLElement | undefined {
    return knobs.find((k) => k.dataset.paramid === paramId);
}

describe('EffectsSection', () => {
    describe('sub-tab navigation', () => {
        it('renders the Dist tab content by default and exposes its knobs', () => {
            renderSection();
            const knobs = screen.getAllByTestId('knob');
            // Dist tab exposes Mix, Drive, Tone in that order.
            expect(knobs.some((k) => k.dataset.paramid === 'distMix')).toBe(true);
            expect(knobs.some((k) => k.dataset.paramid === 'distDrive')).toBe(true);
            expect(knobs.some((k) => k.dataset.paramid === 'distTone')).toBe(true);
        });

        it('switches tabs and exposes only the active tab controls', () => {
            renderSection();
            // Dist is active → no comp knobs yet.
            expect(screen.queryAllByTestId('knob').some((k) => k.dataset.paramid === 'compRatio')).toBe(false);

            fireEvent.click(screen.getByText('Comp'));
            expect(screen.getAllByTestId('knob').some((k) => k.dataset.paramid === 'compRatio')).toBe(true);
        });
    });

    describe('distortion tab', () => {
        it('routes the Mix/Drive/Tone knobs to onParam with the right keys', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            const knobs = screen.getAllByTestId('knob');

            fireEvent.click(knobs.find((k) => k.dataset.paramid === 'distMix')!);
            expect(onParam).toHaveBeenLastCalledWith('distMix', 0.9);
            fireEvent.click(knobs.find((k) => k.dataset.paramid === 'distDrive')!);
            expect(onParam).toHaveBeenLastCalledWith('distDrive', 0.9);
            fireEvent.click(knobs.find((k) => k.dataset.paramid === 'distTone')!);
            expect(onParam).toHaveBeenLastCalledWith('distTone', 0.9);
        });
    });

    describe('compressor tab', () => {
        it('routes Mix/Thresh/Ratio/Attack/Release knobs to onParam', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            const knobs = selectTab('Comp');

            for (const paramId of ['compMix', 'compThreshold', 'compRatio', 'compAttack', 'compRelease']) {
                const k = knobByParamId(knobs, paramId);
                expect(k, `expected ${paramId} knob`).toBeTruthy();
                fireEvent.click(k!);
                expect(onParam).toHaveBeenLastCalledWith(paramId, 0.9);
            }
        });
    });

    describe('reverb tab', () => {
        /// Regression (fermenter audit F3): the Plate/FDN toggle wrote the
        /// literal loop index `i`, so selecting FDN must emit 1 (not 0).
        it('writes reverbType=0 for Plate and reverbType=1 for FDN', () => {
            const onParam = vi.fn();
            renderSection({ reverbType: 1, onParam });
            selectTab('Reverb');

            fireEvent.click(screen.getByRole('button', { name: 'Plate' }));
            expect(onParam).toHaveBeenLastCalledWith('reverbType', 0);
            fireEvent.click(screen.getByRole('button', { name: 'FDN' }));
            expect(onParam).toHaveBeenLastCalledWith('reverbType', 1);
        });

        it('routes Mix/Decay knobs to onParam', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            const knobs = selectTab('Reverb');
            fireEvent.click(knobByParamId(knobs, 'reverbMix')!);
            expect(onParam).toHaveBeenLastCalledWith('reverbMix', 0.9);
            fireEvent.click(knobByParamId(knobs, 'reverbDecay')!);
            expect(onParam).toHaveBeenLastCalledWith('reverbDecay', 0.9);
        });

        it('rounds reverbType before comparing to toggle index', () => {
            const onParam = vi.fn();
            // 0.6 rounds to 1 → FDN is the selected toggle.
            renderSection({ reverbType: 0.6, onParam });
            selectTab('Reverb');
            // The load-bearing check: clicking Plate still writes 0 regardless
            // of how the incoming reverbType was rounded.
            fireEvent.click(screen.getByRole('button', { name: 'Plate' }));
            expect(onParam).toHaveBeenLastCalledWith('reverbType', 0);
        });
    });

    describe('delay tab', () => {
        it('routes Mix/Time/Feedback knobs to onParam', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            const knobs = selectTab('Delay');
            fireEvent.click(knobByParamId(knobs, 'delayMix')!);
            expect(onParam).toHaveBeenLastCalledWith('delayMix', 0.9);
            fireEvent.click(knobByParamId(knobs, 'delayTime')!);
            expect(onParam).toHaveBeenLastCalledWith('delayTime', 0.9);
            fireEvent.click(knobByParamId(knobs, 'delayFeedback')!);
            expect(onParam).toHaveBeenLastCalledWith('delayFeedback', 0.9);
        });
    });

    describe('mod (chorus/phaser) tab', () => {
        it('routes chorus and phaser knobs to onParam', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            const knobs = selectTab('Chorus/Phaser');
            fireEvent.click(knobByParamId(knobs, 'chorusMix')!);
            expect(onParam).toHaveBeenLastCalledWith('chorusMix', 0.9);
            fireEvent.click(knobByParamId(knobs, 'chorusRate')!);
            expect(onParam).toHaveBeenLastCalledWith('chorusRate', 0.9);
            fireEvent.click(knobByParamId(knobs, 'chorusDepth')!);
            expect(onParam).toHaveBeenLastCalledWith('chorusDepth', 0.9);
            fireEvent.click(knobByParamId(knobs, 'phaserMix')!);
            expect(onParam).toHaveBeenLastCalledWith('phaserMix', 0.9);
            fireEvent.click(knobByParamId(knobs, 'phaserRate')!);
            expect(onParam).toHaveBeenLastCalledWith('phaserRate', 0.9);
            fireEvent.click(knobByParamId(knobs, 'phaserDepth')!);
            expect(onParam).toHaveBeenLastCalledWith('phaserDepth', 0.9);
        });
    });

    describe('EQ tab', () => {
        it('renders the EQ curve visualizer with no rotary knobs', () => {
            renderSection();
            fireEvent.click(screen.getByText('EQ'));
            // EQ panel exposes only the curve, no RotaryKnob controls.
            expect(screen.queryAllByTestId('knob')).toHaveLength(0);
            expect(screen.getByRole('img', { name: /drag band dots to adjust/i })).toBeInTheDocument();
        });
    });

    describe('master tab', () => {
        it('formats the stereoWidth readout as Mono when below 1%', () => {
            renderSection({ stereoWidth: 0.005 });
            fireEvent.click(screen.getByText('Master'));
            expect(screen.getByText('Mono')).toBeInTheDocument();
        });

        it('formats the stereoWidth readout as a whole-number percentage', () => {
            renderSection({ stereoWidth: 1.235 });
            fireEvent.click(screen.getByText('Master'));
            // 1.235 * 100 = 123.5 → rounds to 124
            expect(screen.getByText('124%')).toBeInTheDocument();
        });

        it('formats the masterGain readout as a whole-number percentage', () => {
            renderSection({ masterGain: 0.837 });
            fireEvent.click(screen.getByText('Master'));
            // 0.837 * 100 = 83.7 → toFixed(0) → "84"
            expect(screen.getByText('84%')).toBeInTheDocument();
        });

        it('routes the stereoWidth and masterGain knobs to onParam', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            fireEvent.click(screen.getByText('Master'));
            const knobs = screen.getAllByTestId('knob');
            fireEvent.click(knobs.find((k) => k.dataset.paramid === 'stereoWidth')!);
            expect(onParam).toHaveBeenLastCalledWith('stereoWidth', 0.9);
            fireEvent.click(knobs.find((k) => k.dataset.paramid === 'masterGain')!);
            expect(onParam).toHaveBeenLastCalledWith('masterGain', 0.9);
        });
    });
});
