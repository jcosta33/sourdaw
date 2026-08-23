import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStoreSelector } from '#/infra/store/useStoreSelector';

import { DEFAULT_A4_REFERENCE_HZ, MAX_A4_REFERENCE_HZ, MIN_A4_REFERENCE_HZ } from '../../../models/A4Reference';
import { getTunerState } from '../../../stores/tunerStore';
import { setA4Reference } from '../../../useCases/setA4Reference';
import { TunerPanel } from '../TunerPanel';

// Shared sentinels — hoisted so both store mocks and the useStoreSelector mock
// close over the SAME store references, letting the selector mock branch on
// identity.
const { TUNER_STORE_SENTINEL, TRACK_STORE_SENTINEL, fixtureInstances, fixtureState, fixtureTrackState, knobProps } =
    vi.hoisted(() => {
        const fixtureState: {
            noteName: string;
            octave: number;
            cents: number;
            confidence: number;
            active: boolean;
            mode: 'needle' | 'strobe' | 'poly';
            frequency: number;
        } = {
            noteName: 'A',
            octave: 4,
            cents: 0,
            confidence: 0.95,
            active: true,
            mode: 'needle',
            frequency: 440,
        };
        // Fixture record the tunerStore subscription resolves against. The
        // component selects `instances[deviceId]`, so the mock runs the real
        // selector against this record rather than returning a flat fixture.
        const fixtureInstances: Record<string, typeof fixtureState> = { 'device-123': fixtureState };
        // Authoritative project row for the same device. The stored reference is
        // 432 Hz — deliberately NOT the descriptor default — so a panel reading
        // its fallback instead of the device row shows 440 and reds.
        const fixtureTrackState: {
            tracks: { id: string; devices: { id: string; parameterValues: Record<string, number> }[] }[];
        } = {
            tracks: [
                {
                    id: 'track-1',
                    devices: [{ id: 'device-123', parameterValues: { a4_hz: 432 } }],
                },
            ],
        };
        return {
            TUNER_STORE_SENTINEL: { name: 'tunerStore' },
            TRACK_STORE_SENTINEL: { name: 'trackStore' },
            fixtureState,
            fixtureInstances,
            fixtureTrackState,
            knobProps: { last: null as { min: number; max: number; defaultValue: number; value: number } | null },
        };
    });

// Mock the selector subscription. Branch on the store argument: the tunerStore
// sentinel resolves against `fixtureInstances`, the trackStore sentinel against
// the project fixture. A subscription to any other store is a test bug —
// surface it loudly instead of silently feeding one of the two fixtures (which
// would mask a wrong-store subscription).
vi.mock('#/infra/store/useStoreSelector', () => ({
    useStoreSelector: vi.fn((store: unknown, selector: (state: unknown) => unknown) => {
        if (store === TUNER_STORE_SENTINEL) {
            return selector(fixtureInstances);
        }
        if (store === TRACK_STORE_SENTINEL) {
            return selector(fixtureTrackState);
        }
        throw new Error('useStoreSelector called with an unexpected store');
    }),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: TRACK_STORE_SENTINEL,
}));

vi.mock('../../../stores/tunerStore', () => ({
    tunerStore: TUNER_STORE_SENTINEL,
    getTunerState: vi.fn((_deviceId: unknown) => ({ ...fixtureState })),
}));

vi.mock('../../../useCases/setDisplayMode', () => ({
    setDisplayMode: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('../../../useCases/setA4Reference', () => ({
    setA4Reference: vi.fn<(...args: unknown[]) => unknown>(),
}));

// Mock UI components
vi.mock('#/components/daw/DawPluginLed', () => ({
    DawPluginLed: ({ children }: { children: React.ReactNode }) => <span data-testid="daw-plugin-led">{children}</span>,
}));

vi.mock('#/components/daw/DawPluginMetricTile', () => ({
    DawPluginMetricTile: ({
        label,
        value,
        detail,
    }: {
        label: React.ReactNode;
        value: React.ReactNode;
        detail?: React.ReactNode;
    }) => (
        <div data-testid="metric-tile">
            <span>{label}</span>
            <span>{value}</span>
            <span>{detail}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawPluginSectionCard', () => ({
    DawPluginSectionCard: ({
        title,
        children,
        detail,
        className,
    }: {
        title: React.ReactNode;
        children?: React.ReactNode;
        detail?: React.ReactNode;
        className?: string;
    }) => (
        <section data-testid="section-card" className={className}>
            <h3>{title}</h3>
            <div>{detail}</div>
            {children}
        </section>
    ),
}));

// Models the real `RotaryKnob` contract, which is a *two*-argument callback:
// every pointer-move that crosses a step calls `onChange(value, true)` and
// release calls it once more with `false` (`RotaryKnob.tsx:307` and `:189`). A
// single-argument double is what let a drag ship as ninety CRDT commits — the
// stand-in could not express the difference between a preview and a commit, so
// no assertion here could see it. `data-testid="rotary-knob"` is the move,
// `rotary-knob-release` is the release.
//
// `type="number"` rather than `range`: jsdom sanitizes a range input's value
// against its default 0..100 bounds, which would clamp every Hz reading this
// panel drives to 100 and make the routing assertions meaningless.
vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({
        value,
        onChange,
        min,
        max,
        defaultValue,
    }: {
        value: number;
        onChange: (val: number, isTransient?: boolean) => void;
        min: number;
        max: number;
        defaultValue: number;
    }) => {
        knobProps.last = { min, max, defaultValue, value };
        return (
            <>
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value), true)}
                    data-testid="rotary-knob"
                />
                <button type="button" data-testid="rotary-knob-release" onClick={() => onChange(value, false)}>
                    release
                </button>
            </>
        );
    },
}));

describe('TunerPanel', () => {
    const mockDeviceId = 'device-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Scoring/i)).toBeInTheDocument();
    });

    it('should render display mode buttons', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Needle')).toBeInTheDocument();
        expect(screen.getByText('Strobe')).toBeInTheDocument();
        expect(screen.getByText('Poly')).toBeInTheDocument();
    });

    it('keeps sidebar cards from shrinking their controls into the next card hit area', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        expect(screen.getAllByTestId('section-card')).toHaveLength(4);
        for (const card of screen.getAllByTestId('section-card')) {
            expect(card).toHaveClass('shrink-0');
        }
    });

    it('should render reference section with knob', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        // Get all "Reference" texts and check that at least one exists
        expect(screen.getAllByText(/Reference/i).length).toBeGreaterThan(0);
        expect(screen.getByTestId('rotary-knob')).toBeInTheDocument();
    });

    // The reference readout is the device's stored `a4_hz` — the same row the
    // engine is fed — not a panel-local mirror. The fixture stores 432 while the
    // descriptor default is 440, so reading the wrong source shows 440.
    it('reads the reference off the device parameter row, not the descriptor default', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        expect(screen.getAllByText('432 Hz').length).toBeGreaterThan(0);
        expect(screen.queryByText(`${DEFAULT_A4_REFERENCE_HZ} Hz`)).not.toBeInTheDocument();
    });

    // A device with no row in the project falls back to the descriptor default
    // rather than to another device's reading.
    it('falls back to the descriptor default for a device absent from the project', () => {
        render(<TunerPanel deviceId="missing-device" />);

        expect(screen.getAllByText(`${DEFAULT_A4_REFERENCE_HZ} Hz`).length).toBeGreaterThan(0);
        expect(screen.queryByText('432 Hz')).not.toBeInTheDocument();
    });

    // Moving the knob has to reach `setA4Reference`, which is the only path to
    // the DSP's `a4_hz`. Whole Hz: the descriptor is continuous, so the panel is
    // what quantises, and a fractional reading would land in the project file.
    // A move is transient — it previews, it does not commit.
    it('routes a knob move to setA4Reference as a transient whole number of hertz', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        fireEvent.change(screen.getByTestId('rotary-knob'), { target: { value: '415.6' } });

        expect(setA4Reference).toHaveBeenCalledWith(mockDeviceId, 416, true);
    });

    // The gesture, not the pointer-move, is the edit. A sweep from the stored
    // 432 Hz down to 415 crosses three sampled steps here; every one of them
    // must arrive transient, and exactly one commit may follow on release. The
    // committed value is the last one dragged to (415), not the value the device
    // row still holds.
    //
    // Mutation that reds this (ADR 0015): drop the `isTransient` branch in the
    // knob's `onChange` and always call `setA4Reference(deviceId, hz)` — all four
    // calls then arrive with `isTransient` undefined, and the commit count goes
    // to 4.
    it('commits a drag once, on release, and previews every move before it', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        const knob = screen.getByTestId('rotary-knob');
        for (const hz of ['428', '421', '415']) {
            fireEvent.change(knob, { target: { value: hz } });
        }
        fireEvent.click(screen.getByTestId('rotary-knob-release'));

        const calls = vi.mocked(setA4Reference).mock.calls;
        expect(calls).toEqual([
            [mockDeviceId, 428, true],
            [mockDeviceId, 421, true],
            [mockDeviceId, 415, true],
            [mockDeviceId, 415, false],
        ]);
        expect(calls.filter((call) => call[2] === false)).toHaveLength(1);
    });

    // The three "Hz" readouts follow the drag. The transient half of
    // `setA4Reference` writes the engine and not the project, so the device row
    // sits at 432 for the whole gesture — without the local preview the panel
    // would claim 432 while the engine is already tuning to 415.
    it('shows the dragged reference while the gesture is still transient', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        fireEvent.change(screen.getByTestId('rotary-knob'), { target: { value: '415' } });

        expect(screen.getAllByText('415 Hz').length).toBeGreaterThan(0);
        expect(screen.queryByText('432 Hz')).not.toBeInTheDocument();
    });

    // Release hands the readout back to the authoritative device row. The
    // fixture row never moves (the action is mocked), so the panel must fall
    // back to 432 rather than keeping the preview alive — a preview that
    // outlived its gesture would mask an undo or a peer edit.
    it('hands the readout back to the device row once the gesture commits', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        fireEvent.change(screen.getByTestId('rotary-knob'), { target: { value: '415' } });
        fireEvent.click(screen.getByTestId('rotary-knob-release'));

        expect(screen.getAllByText('432 Hz').length).toBeGreaterThan(0);
        expect(screen.queryByText('415 Hz')).not.toBeInTheDocument();
    });

    // The knob's sweep is the descriptor's declared range (welded to the
    // registry in models/__tests__/A4Reference.spec.ts). A wider sweep would
    // offer readings the write door silently pins.
    it('sweeps the declared reference range', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        expect(knobProps.last).toEqual({
            min: MIN_A4_REFERENCE_HZ,
            max: MAX_A4_REFERENCE_HZ,
            defaultValue: DEFAULT_A4_REFERENCE_HZ,
            value: 432,
        });
    });

    it('should display current note when active', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should render metric tiles', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getAllByText('Cents').length).toBeGreaterThan(0);
        expect(screen.getByText('Pitch')).toBeInTheDocument();
        expect(screen.getByText('Conf')).toBeInTheDocument();
    });

    it('should display cents value', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        // We look for +0.0 or 0.0 or just 0
        expect(screen.getAllByText(/\+?0\.0/).length).toBeGreaterThan(0);
    });

    it('should display confidence value', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('95%')).toBeInTheDocument();
    });

    // Fix: clamp confidence to [0,1] before display so an out-of-range worklet value
    // cannot render the Conf tile above 100% (or below 0%).
    it('clamps an above-range confidence to 100% on the Conf tile', () => {
        fixtureState.confidence = 1.2;
        try {
            render(<TunerPanel deviceId={mockDeviceId} />);
            expect(screen.getByText('100%')).toBeInTheDocument();
            expect(screen.queryByText('120%')).not.toBeInTheDocument();
        } finally {
            fixtureState.confidence = 0.95;
        }
    });

    it('clamps a below-range confidence to 0% on the Conf tile', () => {
        fixtureState.confidence = -0.5;
        try {
            render(<TunerPanel deviceId={mockDeviceId} />);
            expect(screen.getByText('0%')).toBeInTheDocument();
            expect(screen.queryByText('-50%')).not.toBeInTheDocument();
        } finally {
            fixtureState.confidence = 0.95;
        }
    });

    it('should render section cards', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Display')).toBeInTheDocument();
        expect(screen.getAllByText(/Reference/i).length).toBeGreaterThan(0);
    });

    it('should render guide section', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Guide')).toBeInTheDocument();
        expect(screen.getByText('Tight zone')).toBeInTheDocument();
        expect(screen.getByText('Usable zone')).toBeInTheDocument();
    });

    it('should render quick read section', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Quick read')).toBeInTheDocument();
    });

    // Fix 1: subscribe to this device's instance only, not the whole record.
    it('selects only this device instance from the tuner store', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        const [storeArg, selector] = vi.mocked(useStoreSelector).mock.calls[0]!;
        // The store identity is the tunerStore sentinel (Fix 6 branch guard would
        // have thrown otherwise), and the selector narrows to instances[deviceId].
        expect(storeArg).toBe(TUNER_STORE_SENTINEL);
        expect(selector(fixtureInstances)).toBe(fixtureInstances[mockDeviceId]);
    });

    // Fix 1 + Fix 6: an unknown device falls back through getTunerState rather than
    // re-rendering the whole panel set; the selector must not return another device.
    it('falls back to getTunerState for a device absent from the record', () => {
        render(<TunerPanel deviceId="missing-device" />);

        const selector = vi.mocked(useStoreSelector).mock.calls[0]![1];
        vi.mocked(getTunerState).mockClear();
        const selected = selector(fixtureInstances);

        expect(getTunerState).toHaveBeenCalledWith('missing-device');
        expect(selected).not.toBe(fixtureInstances[mockDeviceId]);
    });

    // Fix 4: the three mode buttons expose aria-pressed reflecting the active mode.
    it('marks the active mode button as pressed and the others as not', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        // Fixture mode is 'needle'.
        expect(screen.getByRole('button', { name: 'Needle display mode' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Strobe display mode' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Poly display mode' })).toHaveAttribute('aria-pressed', 'false');
    });

    // Fix 4: each tuner canvas is a labelled image for assistive tech.
    it('labels the active display canvas for assistive tech', () => {
        render(<TunerPanel deviceId={mockDeviceId} />);

        // Fixture mode 'needle' renders the needle canvas plus the history graph.
        expect(screen.getByRole('img', { name: 'Needle tuner display' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Pitch history graph' })).toBeInTheDocument();
    });

    // Fix 2: the needle display draws on a requestAnimationFrame idle loop (reading
    // telemetry from refs) rather than synchronously inside a prop-dep useEffect. The
    // old model ran a full clear+gradients+arcs+needle redraw on every telemetry tick.
    // Needle mode therefore schedules its OWN rAF loop on top of the always-present
    // history graph; poly mode (no needle) schedules strictly fewer.
    it('drives the needle display from its own requestAnimationFrame loop', () => {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
        try {
            // Poly mode: history graph only.
            fixtureState.mode = 'poly';
            const poly = render(<TunerPanel deviceId={mockDeviceId} />);
            const polyRafCount = rafSpy.mock.calls.length;
            poly.unmount();
            rafSpy.mockClear();

            // Needle mode: history graph + the needle's own idle-draw loop.
            fixtureState.mode = 'needle';
            render(<TunerPanel deviceId={mockDeviceId} />);
            const needleRafCount = rafSpy.mock.calls.length;

            expect(needleRafCount).toBeGreaterThan(polyRafCount);
        } finally {
            fixtureState.mode = 'needle';
            rafSpy.mockRestore();
        }
    });

    // Fix 3: the needle canvas backs its buffer with physical (dpr-scaled) pixels so
    // it renders sharp on retina, like the strobe and history canvases.
    it('scales the needle canvas backing buffer by devicePixelRatio', () => {
        vi.stubGlobal('devicePixelRatio', 2);
        try {
            render(<TunerPanel deviceId={mockDeviceId} />);
            const canvas = screen.getByRole('img', { name: 'Needle tuner display' });
            // Logical 480x200 multiplied by dpr=2.
            expect(canvas).toHaveAttribute('width', '960');
            expect(canvas).toHaveAttribute('height', '400');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    // Fix 4: a polite live region announces the read after the debounce settles.
    it('announces the current read through a debounced live region', () => {
        vi.useFakeTimers();
        try {
            render(<TunerPanel deviceId={mockDeviceId} />);

            const liveRegion = screen.getByRole('status');
            expect(liveRegion).toHaveAttribute('aria-live', 'polite');
            // Fixture: A4, 0 cents → "A4, sharp 0 cents" once the debounce fires.
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(liveRegion).toHaveTextContent('A4, sharp 0 cents');
        } finally {
            vi.useRealTimers();
        }
    });
});
