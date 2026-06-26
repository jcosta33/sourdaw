import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { crustStore, defaultCrustState, type CrustState } from '../../../stores/crustStore';
import { CrustPanel } from '../CrustPanel';

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
});
