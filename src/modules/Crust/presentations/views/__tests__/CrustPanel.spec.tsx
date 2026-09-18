import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CRUST_OVERSAMPLE_FACTORS, DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import {
    crustStore,
    crustMeterStore,
    defaultCrustState,
    INITIAL_METERS,
    type CrustInstanceState,
    type CrustMeterState,
} from '../../../stores/crustStore';
import { CrustPanel } from '../CrustPanel';

const useCaseMocks = vi.hoisted(() => ({
    resetCrustPanelMeters: vi.fn(),
    resetCrustTruePeakIndicator: vi.fn(),
    setCrustPanelUiLevel: vi.fn(),
    setCrustParamWithAudio: vi.fn(),
    hydrateCrustPatchFromProject: vi.fn(),
    useCrustMeters: vi.fn(),
}));

vi.mock('../../../useCases/crustParamBridge/setCrustParamWithAudio', () => ({
    setCrustParamWithAudio: useCaseMocks.setCrustParamWithAudio,
}));

vi.mock('../../../useCases/crustParamBridge/hydrateCrustPatchFromProject', () => ({
    hydrateCrustPatchFromProject: useCaseMocks.hydrateCrustPatchFromProject,
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

// The meters hook is the panel's only meter source, so each case hands it an
// exact reading. The patch arrives through the instances store below.
vi.mock('../../hooks/useCrustMeters', () => ({
    useCrustMeters: (deviceId: string) => (useCaseMocks.useCrustMeters as (id: string) => CrustMeterState)(deviceId),
}));

// useStore is mocked so each case can hand CrustPanel an exact instances map
// and observe what the view derives from it. Any other store (e.g. the track
// state the hydration effect reads) falls back to its supplied default so the
// subtree still renders.
let crustInstancesForTest: Record<string, CrustInstanceState> = {};
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultValue: unknown) => {
        if (store === crustStoreRef.current) {
            return crustInstancesForTest;
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

function instanceWith(patchPartial: Partial<typeof DEFAULT_CRUST_PATCH>): CrustInstanceState {
    return { patch: { ...DEFAULT_CRUST_PATCH, ...patchPartial } };
}

describe('CrustPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crustStoreRef.current = crustStore;
        crustInstancesForTest = {};
        useCaseMocks.useCrustMeters.mockReturnValue(INITIAL_METERS);
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('forwards the store meter floor (-100) for input/output verbatim', () => {
        useCaseMocks.useCrustMeters.mockReturnValue(defaultCrustState);

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
        useCaseMocks.useCrustMeters.mockReturnValue({ ...INITIAL_METERS, inputDb: -73, outputDb: -84 });

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps();
        expect(props.inputDb).toBe(-73);
        expect(props.outputDb).toBe(-84);
    });

    it('does not inject a -60 magic number when a meter field is absent', () => {
        // The dead `state?.inputDb ?? -60` ladder only ever diverged from a
        // direct read when the field was nullish — the one input that
        // distinguishes the buggy fallback from a faithful pass-through. With
        // the fallback present the renderer saw -60; after the fix it sees the
        // store value as-is and never the stray magic number.
        useCaseMocks.useCrustMeters.mockReturnValue({
            ...INITIAL_METERS,
            inputDb: undefined as unknown as number,
            outputDb: undefined as unknown as number,
        });

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps();
        expect(props.inputDb).not.toBe(-60);
        expect(props.outputDb).not.toBe(-60);
    });

    it('treats the custom preset as no fixed LUFS target (null), matching its skipped ceiling write', () => {
        // 'custom' labels itself "Custom" and skips the ceiling write, so the
        // derived target must be null — not the −14 the menu lists only as a
        // suggested starting point. The waveform's lufsTarget prop is the
        // observable seam: a non-null number here would draw a target line and
        // drive penalty math the label denies.
        crustInstancesForTest = { 'crust-1': instanceWith({ streamingPreset: 'custom' }) };

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps() as unknown as { lufsTarget: number | null };
        expect(props.lufsTarget).toBeNull();
    });

    it('derives the fixed LUFS target for a non-custom preset', () => {
        crustInstancesForTest = { 'crust-1': instanceWith({ streamingPreset: 'ebu_r128' }) };

        render(<CrustPanel deviceId="crust-1" />);

        const props = lastWaveformProps() as unknown as { lufsTarget: number | null };
        expect(props.lufsTarget).toBe(-23);
    });

    it('renders its own device’s patch, never another instance’s (#3672)', () => {
        // Crust A pushed its ceiling to -1.5; B's own saved value is the
        // default -0.3. Opening B must read B — the singleton projection the
        // issue fixes rendered A's -1.5 on B's panel.
        crustInstancesForTest = {
            'crust-a': instanceWith({ ceiling: -1.5 }),
            'crust-b': instanceWith({ ceiling: DEFAULT_CRUST_PATCH.ceiling }),
        };

        render(<CrustPanel deviceId="crust-b" />);

        expect(screen.getByText(`${DEFAULT_CRUST_PATCH.ceiling.toFixed(1)} dBTP`)).toBeInTheDocument();
    });

    it('renders its own device’s meters even after another instance ticked (#3672)', () => {
        useCaseMocks.useCrustMeters.mockImplementation((deviceId: string) =>
            deviceId === 'crust-a' ? { ...INITIAL_METERS, inputDb: -12 } : { ...INITIAL_METERS, inputDb: -30 }
        );
        crustInstancesForTest = {
            'crust-a': instanceWith({}),
            'crust-b': instanceWith({}),
        };

        render(<CrustPanel deviceId="crust-b" />);

        // B's panel forwards B's frame, not the -12 A emitted.
        expect(lastWaveformProps().inputDb).toBe(-30);
    });

    it('hydrates the visible patch from the project before first paint of the effect run', () => {
        // The hydration effect runs on mount with the panel's own device id —
        // the inbound projection the bridge specs never covered (#3673).
        crustInstancesForTest = { 'crust-1': instanceWith({}) };
        render(<CrustPanel deviceId="crust-1" />);

        expect(useCaseMocks.hydrateCrustPatchFromProject).toHaveBeenCalledWith('crust-1');
    });

    it('should route level chip writes through the Crust panel UI-level use case with the device id', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'L4' }));

        expect(useCaseMocks.setCrustPanelUiLevel).toHaveBeenCalledWith('crust-1', 4);
    });

    it('should route footer meter reset through the Crust panel meter use case with the device id', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(useCaseMocks.resetCrustPanelMeters).toHaveBeenCalledWith('crust-1');
    });

    it('should route true peak reset through the Crust true peak use case with the device id', () => {
        render(<CrustPanel deviceId="crust-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Reset true peak indicator' }));

        expect(useCaseMocks.resetCrustTruePeakIndicator).toHaveBeenCalledWith('crust-1');
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

    it('applies minimum height floor and does not clip overflow at root', () => {
        const { container } = render(<CrustPanel deviceId="crust-1" />);
        const faceplate = container.querySelector('.crust-faceplate');
        expect(faceplate).toHaveClass('min-h-[440px]');
        expect(faceplate).not.toHaveClass('overflow-hidden');
    });

    it('keeps control zone scroll container from collapsing sections with [&>*]:shrink-0', () => {
        render(<CrustPanel deviceId="crust-1" />);
        const missionControlHeader = screen.getByText('Mission control');
        const scrollContainer = missionControlHeader.closest('.overflow-y-auto');
        expect(scrollContainer).not.toBeNull();
        expect(scrollContainer).toHaveClass('[&>*]:shrink-0');
    });
});
