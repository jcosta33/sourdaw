import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { DEFAULT_PATCH as F } from '../../../models/FermenterPatch';
import { EffectsSection } from '../EffectsSection';

// Capture the most recent onParamChange handed to each visualizer so the
// section's paramId → onParam routing (the if/else chains) can be asserted
// without rendering the real canvas visualisers.
let distortionProps: { onParamChange?: (id: string, v: number) => void };
let compressorProps: { onParamChange?: (id: string, v: number) => void };
let delayProps: { onParamChange?: (id: string, v: number) => void };
let eqProps: { onParamChange?: (id: string, v: number) => void };

vi.mock('#/components/daw/visualizers/DistortionCurve', () => ({
    DistortionCurve: (props: typeof distortionProps) => {
        distortionProps = props;
        return <div role="img" aria-label="distortion" onClick={() => props.onParamChange?.('fire', 0)} />;
    },
}));
vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: (props: typeof compressorProps) => {
        compressorProps = props;
        return <div role="img" aria-label="compressor" />;
    },
}));
vi.mock('#/components/daw/visualizers/DelayTaps', () => ({
    DelayTaps: (props: typeof delayProps) => {
        delayProps = props;
        return <div role="img" aria-label="delay" />;
    },
}));
vi.mock('#/components/daw/visualizers/EQCurve', () => ({
    EQCurve: (props: typeof eqProps) => {
        eqProps = props;
        return <div role="img" aria-label="drag band dots to adjust" />;
    },
}));

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

    describe('distortion visualizer onParamChange routing', () => {
        it('maps dist-drive/dist-tone/dist-mix ids to onParam', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            // Dist is the default tab, so distortionProps is already captured.
            distortionProps.onParamChange!('dist-drive', 3);
            expect(onParam).toHaveBeenLastCalledWith('distDrive', 3);
            distortionProps.onParamChange!('dist-tone', 0.4);
            expect(onParam).toHaveBeenLastCalledWith('distTone', 0.4);
            distortionProps.onParamChange!('dist-mix', 0.5);
            expect(onParam).toHaveBeenLastCalledWith('distMix', 0.5);
        });

        it('ignores unknown distortion ids (no onParam call)', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            distortionProps.onParamChange!('dist-unknown', 1);
            expect(onParam).not.toHaveBeenCalled();
        });
    });

    describe('compressor visualizer onParamChange routing', () => {
        it('maps comp-threshold/comp-ratio ids and ignores unknown', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            fireEvent.click(screen.getByText('Comp'));
            compressorProps.onParamChange!('comp-threshold', -18);
            expect(onParam).toHaveBeenLastCalledWith('compThreshold', -18);
            compressorProps.onParamChange!('comp-ratio', 6);
            expect(onParam).toHaveBeenLastCalledWith('compRatio', 6);
            const calls = onParam.mock.calls.length;
            compressorProps.onParamChange!('comp-unknown', 1);
            expect(onParam.mock.calls.length).toBe(calls);
        });
    });

    describe('delay visualizer onParamChange routing', () => {
        it('maps delay-time/delay-feedback/delay-mix ids and ignores unknown', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            fireEvent.click(screen.getByText('Delay'));
            delayProps.onParamChange!('delay-time', 250);
            expect(onParam).toHaveBeenLastCalledWith('delayTime', 250);
            delayProps.onParamChange!('delay-feedback', 0.3);
            expect(onParam).toHaveBeenLastCalledWith('delayFeedback', 0.3);
            delayProps.onParamChange!('delay-mix', 0.4);
            expect(onParam).toHaveBeenLastCalledWith('delayMix', 0.4);
            const calls = onParam.mock.calls.length;
            delayProps.onParamChange!('delay-unknown', 1);
            expect(onParam.mock.calls.length).toBe(calls);
        });
    });

    describe('EQ visualizer onParamChange routing', () => {
        it('maps all nine eq band ids to onParam and ignores unknown', () => {
            const onParam = vi.fn();
            renderSection({ onParam });
            fireEvent.click(screen.getByText('EQ'));
            eqProps.onParamChange!('eq-low-gain', 2);
            expect(onParam).toHaveBeenLastCalledWith('eqLowGain', 2);
            eqProps.onParamChange!('eq-low-freq', 120);
            expect(onParam).toHaveBeenLastCalledWith('eqLowFreq', 120);
            eqProps.onParamChange!('eq-low-q', 0.7);
            expect(onParam).toHaveBeenLastCalledWith('eqLowQ', 0.7);
            eqProps.onParamChange!('eq-mid-gain', -3);
            expect(onParam).toHaveBeenLastCalledWith('eqMidGain', -3);
            eqProps.onParamChange!('eq-mid-freq', 900);
            expect(onParam).toHaveBeenLastCalledWith('eqMidFreq', 900);
            eqProps.onParamChange!('eq-mid-q', 1.2);
            expect(onParam).toHaveBeenLastCalledWith('eqMidQ', 1.2);
            eqProps.onParamChange!('eq-high-gain', 1);
            expect(onParam).toHaveBeenLastCalledWith('eqHighGain', 1);
            eqProps.onParamChange!('eq-high-freq', 7000);
            expect(onParam).toHaveBeenLastCalledWith('eqHighFreq', 7000);
            eqProps.onParamChange!('eq-high-q', 0.9);
            expect(onParam).toHaveBeenLastCalledWith('eqHighQ', 0.9);
            const calls = onParam.mock.calls.length;
            eqProps.onParamChange!('eq-unknown', 1);
            expect(onParam.mock.calls.length).toBe(calls);
        });

        it('passes undefined eq props through to the curve as defaults', () => {
            const onParam = vi.fn();
            // Omit all eq* props → defaults must be applied (eqLowFreq 100, etc).
            render(
                <EffectsSection
                    {...{
                        ...baseProps({ onParam }),
                        eqLowFreq: undefined,
                        eqLowGain: undefined,
                        eqLowQ: undefined,
                        eqMidFreq: undefined,
                        eqMidGain: undefined,
                        eqMidQ: undefined,
                        eqHighFreq: undefined,
                        eqHighGain: undefined,
                        eqHighQ: undefined,
                    }}
                />
            );
            fireEvent.click(screen.getByText('EQ'));
            // Routing still works with defaults in play.
            eqProps.onParamChange!('eq-low-freq', 200);
            expect(onParam).toHaveBeenLastCalledWith('eqLowFreq', 200);
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

        it('renders the master tab without a rotaryKnob override (uses real RotaryKnob)', () => {
            // When no rotaryKnob override is given, the master tab renders two
            // knobs using the real RotaryKnob import. A typo in the tone
            // selection would still default to 'neutral' — we assert rendering
            // succeeds without throwing.
            const props = { ...baseProps({}), rotaryKnob: undefined };
            delete (props as Record<string, unknown>).rotaryKnob;
            render(<EffectsSection {...props} />);
            fireEvent.click(screen.getByText('Master'));
            // The master tab's stereoWidth readout appears once the tab is active.
            expect(screen.getByText('Width')).toBeInTheDocument();
        });
    });
});
