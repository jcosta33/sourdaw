import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CRUST_OVERSAMPLE_FACTORS } from '../../../models/CrustPatch';
import { crustStore, defaultCrustState, type CrustState } from '../../../stores/crustStore';
import { CrustPanel } from '../CrustPanel';

const useCaseMocks = vi.hoisted(() => ({
    resetCrustPanelMeters: vi.fn(),
    resetCrustTruePeakIndicator: vi.fn(),
    setCrustPanelUiLevel: vi.fn(),
    setCrustParamWithAudio: vi.fn(),
}));

vi.mock('../../../useCases/crustParamBridge/setCrustParamWithAudio', () => ({
    setCrustParamWithAudio: useCaseMocks.setCrustParamWithAudio,
}));

vi.mock('../../../useCases/resetCrustPanelMeters', () => ({
    resetCrustPanelMeters: useCaseMocks.resetCrustPanelMeters,
}));

vi.mock('../../../useCases/resetCrustTruePeakIndicator', () => ({
    resetCrustTruePeakIndicator: useCaseMocks.resetCrustTruePeakIndicator,
}));

vi.mock('../../../useCases/setCrustPanelUiLevel', () => ({
    setCrustPanelUiLevel: useCaseMocks.setCrustPanelUiLevel,
}));

// useStore is mocked so each case can hand CrustPanel an exact CrustState and
// observe what the view derives from it. Any other store (e.g. MIDI-learn state
// reached through child components) falls back to its supplied default so the
// subtree still renders.
let crustStateForTest: CrustState = defaultCrustState;
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultValue: unknown) => {
        if (store === crustStoreRef.current) {
            return crustStateForTest;
        }
        return defaultValue;
    },
}));

// crustStore identity is needed inside the mock factory, which is hoisted above
// the import; reference it lazily through a holder.
const crustStoreRef: { current: unknown } = { current: undefined };

// CrustWaveformDisplay is the public surface where the input/output meter floor
// reaches the renderer. Capture the props CrustPanel forwards to it.
const waveformProps = vi.fn();
vi.mock('../../components/CrustWaveformDisplay', () => ({
    CrustWaveformDisplay: (props: { inputDb: number; outputDb: number }) => {
        waveformProps(props);
        return null;
    },
}));

function lastWaveformProps(): { inputDb: number; outputDb: number } {
    const calls = waveformProps.mock.calls;
    return calls[calls.length - 1]?.[0] as { inputDb: number; outputDb: number };
}

describe('CrustPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crustStoreRef.current = crustStore;
        crustStateForTest = defaultCrustState;
    });

    it('forwards the store meter floor (-100) for input/output verbatim', () => {
        crustStateForTest = defaultCrustState;

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps();
        // INITIAL_METERS seeds inputDb/outputDb at -100; the panel must read it
        // straight from the store, not impose its own number.
        expect(props.inputDb).toBe(defaultCrustState.inputDb);
        expect(props.outputDb).toBe(defaultCrustState.outputDb);
        expect(props.inputDb).toBe(-100);
        expect(props.outputDb).toBe(-100);
    });

    it('passes the store meter values through without a -60 view fallback', () => {
        // The store is the single source of the meter floor. A value the view
        // never produces on its own must reach the renderer untouched.
        crustStateForTest = { ...defaultCrustState, inputDb: -73, outputDb: -84 };

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps();
        expect(props.inputDb).toBe(-73);
        expect(props.outputDb).toBe(-84);
    });

    it('treats the custom preset as no fixed LUFS target (null), matching its skipped ceiling write', () => {
        // 'custom' labels itself "Custom" and skips the ceiling write, so the
        // derived target must be null — not the −14 the menu lists only as a
        // suggested starting point. The waveform's lufsTarget prop is the
        // observable seam: a non-null number here would draw a target line and
        // drive penalty math the label denies.
        crustStateForTest = {
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, streamingPreset: 'custom' },
        };

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps() as unknown as { lufsTarget: number | null };
        expect(props.lufsTarget).toBeNull();
    });

    it('derives the fixed LUFS target for a non-custom preset', () => {
        crustStateForTest = {
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, streamingPreset: 'ebu_r128' },
        };

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps() as unknown as { lufsTarget: number | null };
        expect(props.lufsTarget).toBe(-23);
    });

    it('does not inject a -60 magic number when a meter field is absent', () => {
        // The dead `state?.inputDb ?? -60` ladder only ever diverged from a
        // direct read when the field was nullish — the one input that
        // distinguishes the buggy fallback from a faithful pass-through. With
        // the fallback present the renderer saw -60; after the fix it sees the
        // store value as-is and never the stray magic number.
        crustStateForTest = {
            ...defaultCrustState,
            inputDb: undefined as unknown as number,
            outputDb: undefined as unknown as number,
        };

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps();
        expect(props.inputDb).not.toBe(-60);
        expect(props.outputDb).not.toBe(-60);
    });

    it('should route level chip writes through the Crust panel UI-level use case', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'L4' }));

        expect(useCaseMocks.setCrustPanelUiLevel).toHaveBeenCalledWith(4);
    });

    it('should route footer meter reset through the Crust panel meter use case', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(useCaseMocks.resetCrustPanelMeters).toHaveBeenCalledTimes(1);
    });

    it('should route true peak reset through the Crust true peak use case', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset true peak indicator' }));

        expect(useCaseMocks.resetCrustTruePeakIndicator).toHaveBeenCalledTimes(1);
    });

    it('offers a chip for every oversampling factor the engine builds a stage for', () => {
        // Enumerated from the model's list, not retyped here — the retyped copy
        // this replaces is how 2x went missing from the panel while the cascade
        // in `crates/daw-dsp/src/crust/oversample.rs` had a stage for it.
        render(<CrustPanel deviceId="crust-1" />);

        for (const factor of CRUST_OVERSAMPLE_FACTORS) {
            const label = factor === 1 ? 'OS off' : `${factor}×`;
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }
    });

    it('writes the 2x factor the panel could not previously reach', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: '2×' }));

        expect(useCaseMocks.setCrustParamWithAudio).toHaveBeenCalledWith('crust-1', 'oversampling', 2);
    });

    it('claims no contentinfo landmark for its control strip', () => {
        render(<CrustPanel deviceId="crust-1" />);

        // A device panel is not page footer content. As a <footer> with only <div>
        // ancestors this strip mapped to `contentinfo` and collided with the app
        // status bar, giving the page two of a landmark that must be unique.
        expect(screen.queryByRole('contentinfo')).toBeNull();
        // The controls it holds are still there — this is a tag change, not a delete.
        expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    });
});
