import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { DeviceParameterControl } from '../DeviceParameterControl';
import { TrackAutomationSection } from '../TrackAutomationSection';

import type { DeviceParameterView } from '../../../../models/PluginDescriptorViewTypes';
import type { Device, Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockSetDeviceParameter = vi.fn();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        setDeviceParameter: (...args: unknown[]) => mockSetDeviceParameter(...args),
    };
});

const mockAddAutomationLane = vi.fn();
const mockRemoveAutomationLane = vi.fn();
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...actual,
        addAutomationLane: (...args: unknown[]) => mockAddAutomationLane(...args),
        removeAutomationLane: (...args: unknown[]) => mockRemoveAutomationLane(...args),
    };
});

const mockUseStore = vi.fn((_store: unknown, defaultState: unknown) => defaultState);
const mockMidiLearnRotaryKnob = vi.hoisted(() => vi.fn());
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

// DeviceParameterControl's modulation subscription uses the real
// useStoreSelector hook (narrow subscription, audit M5). Feed it a `null`
// snapshot — same as the untouched `useStore` default below — so every
// existing case here keeps its prior "no modulation" behavior; modulation
// coverage lives in DeviceParameterControl.modulationSubscription.spec.tsx.
vi.mock('#/infra/store/useStoreSelector', () => ({
    useStoreSelector: (_store: unknown, selector: (state: unknown) => unknown) => selector(null),
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { id: 'automation' },
    modulationStore: { id: 'modulation' },
    modulationRuntimeStore: { id: 'modulationRuntime' },
}));

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        value,
        onChange,
        children,
    }: {
        value: number;
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
        children: React.ReactNode;
    }) => (
        <select data-testid="compact-select" value={value} onChange={onChange}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/ui/bipolar-slider', () => ({
    BipolarSlider: ({
        value,
        onValueChange,
        'aria-label': ariaLabel,
    }: {
        value: number;
        onValueChange: (v: number) => void;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            data-testid="bipolar-slider"
            aria-label={ariaLabel}
            value={value}
            onChange={(event) => onValueChange(Number(event.target.value))}
        />
    ),
}));

// Spread `importOriginal` so a control added to the ControlSurface barrel later
// does not resolve to `undefined` here and red every render in this file (#1393).
vi.mock('#/modules/ControlSurface/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/ControlSurface/presentations/views')>()),
    MidiLearnButton: () => <button data-testid="midi-learn-btn">Learn</button>,
    MidiLearnRotaryKnob: (props: { value: number; onChange: (value: number) => void; 'aria-label'?: string }) => {
        mockMidiLearnRotaryKnob(props);
        return (
            <button
                data-testid="rotary-knob"
                data-value={props.value}
                aria-label={props['aria-label']}
                onClick={() => props.onChange(props.value + 1)}
            >
                Knob
            </button>
        );
    },
}));

function useAutomationLanes(lanes: Array<{ id: string; trackId: string; parameterId: string; clipId?: string }>): void {
    mockUseStore.mockImplementation((store: unknown, defaultState: unknown) => {
        if (typeof store === 'object' && store !== null && 'id' in store && store.id === 'automation') {
            return { lanes };
        }
        return defaultState;
    });
}

describe('DeviceParameterControl', () => {
    const mockDevice: Device = {
        id: 'device-1',
        name: 'Test Device',
        type: 'effect',
        bypassed: false,
        parameterValues: { gain: 0.5 },
    };

    const mockParam: DeviceParameterView = {
        id: 'gain',
        deviceId: 'device-1',
        name: 'Gain',
        type: 'float',
        value: 0.5,
        defaultValue: 0.5,
        minValue: 0,
        maxValue: 1,
        unit: '',
        automatable: true,
        hasAutomation: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseStore.mockImplementation((_store: unknown, defaultState: unknown) => defaultState);
    });

    it('should render without crashing', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('should display parameter name', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('should display parameter value', () => {
        // Three decimals, was two. Precision now follows the step rather than
        // the declared span, and a 0..1 parameter steps by 0.005 — the third
        // decimal is the one the knob actually moves in, so hiding it rounded
        // away real changes. Deliberate; capped at three.
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByText('0.500')).toBeInTheDocument();
    });

    it('should render rotary knob for float parameters', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByTestId('rotary-knob')).toBeInTheDocument();
    });

    it('gives the rotary knob the parameter name as its accessible name', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByTestId('rotary-knob')).toHaveAttribute('aria-label', 'Gain');
    });

    it('scopes the rotary MIDI target to the parameter owner', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);

        expect(mockMidiLearnRotaryKnob).toHaveBeenCalledWith(
            expect.objectContaining({
                paramId: 'gain',
                targetType: 'deviceParam',
                trackId: 'track-1',
                deviceId: 'device-1',
            })
        );
    });

    it('spans the full engine range so a sub-0.1 shipped rate is not clamped away by the knob', () => {
        // Nebula Drift's `Sweep Phase` sits at 0.05 Hz and `factory-bass-sub`
        // ships `filterResonance: 0`. `RotaryKnob` clamps to its `min`, so any
        // control floor above a stored value rewrites that value on the first
        // drag — one-way, since neither Home nor alt-click can return to it.
        // The control's range must therefore be the range a write is held to.
        render(
            <DeviceParameterControl
                param={{ ...mockParam, id: 'phaser-rate', name: 'Rate', minValue: 0, maxValue: 10, value: 0.05 }}
                device={mockDevice}
                trackId="track-1"
            />
        );

        expect(mockMidiLearnRotaryKnob).toHaveBeenCalledWith(expect.objectContaining({ min: 0, max: 10 }));
        // Precision comes from the 0.05 step, so the shipped value reads as
        // itself rather than rounding to a floor it never had.
        expect(screen.getByText('0.05')).toBeInTheDocument();
    });

    it('never hands the knob a floor above a shipped value, for any of the widened params', () => {
        // `RotaryKnob.clamp` is `Math.max(min, Math.min(max, v))`, so this one
        // relation is the whole guard: if `min` ever exceeds a stored value,
        // the first drag rewrites it and nothing can bring it back. Checked
        // against the real shipped sub-floor values rather than a fixture.
        const shipped: Array<[string, number, number, number]> = [
            ['phaser-rate', 0, 10, 0.05],
            ['autopan-rate', 0, 10, 0.06],
            ['filterResonance', 0, 20, 0],
        ];

        for (const [id, minValue, maxValue, value] of shipped) {
            mockMidiLearnRotaryKnob.mockClear();
            render(
                <DeviceParameterControl
                    param={{ ...mockParam, id, name: id, minValue, maxValue, value }}
                    device={mockDevice}
                    trackId="track-1"
                />
            );

            const props = mockMidiLearnRotaryKnob.mock.calls[0]![0] as { min: number };
            expect(props.min).toBeLessThanOrEqual(value);
        }
    });

    it('should call setDeviceParameter when knob value changes', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        fireEvent.click(screen.getByTestId('rotary-knob'));
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-1', 'gain', 1.5);
    });

    it('should render select for choice parameters', () => {
        const choiceParam: DeviceParameterView = {
            ...mockParam,
            type: 'choice',
            choices: ['Option A', 'Option B', 'Option C'],
        };
        render(<DeviceParameterControl param={choiceParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByTestId('compact-select')).toBeInTheDocument();
    });

    it('should call setDeviceParameter when choice selection changes', () => {
        const choiceParam: DeviceParameterView = {
            ...mockParam,
            type: 'choice',
            choices: ['Option A', 'Option B', 'Option C'],
        };
        render(<DeviceParameterControl param={choiceParam} device={mockDevice} trackId="track-1" />);
        fireEvent.change(screen.getByTestId('compact-select'), { target: { value: '1' } });
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-1', 'gain', 1);
    });

    // ── A parameter whose engine distinguishes fewer settings than its range ──
    //
    // `crust/oversampling` declares 1..32 and a legal set of {1,2,4,8,16,32}.
    // Read out of the shipped registry rather than fixtured: a fixture would
    // let the control agree with a declaration the product does not have.
    function declaredParam(deviceType: string, paramId: string): DeviceParameterView {
        const parameter = getPluginById(deviceType)?.parameters.find((candidate) => candidate.id === paramId);
        if (!parameter) {
            throw new Error(`${deviceType}/${paramId} is not in the plugin registry`);
        }
        return parameter;
    }

    function crustOversamplingParam(): DeviceParameterView {
        return declaredParam('crust', 'oversampling');
    }

    const crustDevice: Device = {
        id: 'device-crust',
        name: 'Crust',
        type: 'crust',
        bypassed: false,
        parameterValues: { oversampling: 4 },
    };

    it('offers a declared legal set as itself, with no position between its members', () => {
        const param = crustOversamplingParam();
        render(<DeviceParameterControl param={param} device={crustDevice} trackId="track-1" />);

        const select = screen.getByTestId('compact-select') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual(
            (param.legalSet?.values ?? []).map((legal) => String(legal))
        );
        // The narrowing is the whole point: the knob this replaces stepped by 1
        // over the declared span, so it offered 32 positions for 6 settings.
        expect(select.options.length).toBeLessThan(param.maxValue - param.minValue + 1);
    });

    it('writes the factor a legal-set option names, not its index', () => {
        // 2x is the case that motivated this: the engine has always built a 2x
        // stage, and no surface in the product could ask for it. Under the
        // index semantics `choice` uses, '2' would have written 2 meaning "the
        // third option" — 4x.
        render(<DeviceParameterControl param={crustOversamplingParam()} device={crustDevice} trackId="track-1" />);

        fireEvent.change(screen.getByTestId('compact-select'), { target: { value: '2' } });
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-crust', 'oversampling', 2);
    });

    it('shows the member in force when the stored value sits between two of them', () => {
        // 20 is reachable and stored — the old 1..32 knob stepped by 1, and a
        // learned MIDI CC scales 0..127 across the declared span. The engine
        // floors it to 16, so the control has to say 16 rather than blanking or
        // showing its first option.
        render(
            <DeviceParameterControl
                param={crustOversamplingParam()}
                device={{ ...crustDevice, parameterValues: { oversampling: 20 } }}
                trackId="track-1"
            />
        );

        expect(screen.getByTestId('compact-select')).toHaveValue('16');
    });

    it('offers gluten the three factors its oversampler builds, and not the fourth position', () => {
        // 3 sat inside the declared 1..4 and had no stage behind it. The panel
        // had already stopped offering it; the Inspector had not, and this is
        // the surface a knob still put it on.
        render(
            <DeviceParameterControl
                param={declaredParam('gluten', 'oversampling')}
                device={{
                    id: 'device-gluten',
                    name: 'Gluten',
                    type: 'gluten',
                    bypassed: false,
                    parameterValues: { oversampling: 3 },
                }}
                trackId="track-1"
            />
        );

        const select = screen.getByTestId('compact-select') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual(['1', '2', '4']);
        // A stored 3 reads as the 2x the engine now runs for it, not as itself
        // and not as the 4x the old `_ => 4` arm gave it.
        expect(select).toHaveValue('2');
    });

    it('offers dutch-oven only the wire values that select an engine, and reads a reserved one as Plate', () => {
        // 4 and 5 are reserved for the convolution-backed engines and dispatch
        // to Plate. The 0..6 knob offered them as if they were algorithms.
        render(
            <DeviceParameterControl
                param={declaredParam('dutch-oven', 'algorithm')}
                device={{
                    id: 'device-reverb',
                    name: 'Dutch Oven',
                    type: 'dutch-oven',
                    bypassed: false,
                    parameterValues: { algorithm: 4 },
                }}
                trackId="track-1"
            />
        );

        const select = screen.getByTestId('compact-select') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual(['0', '1', '2', '3', '6']);
        // Not '3' — the fallback is Plate, not the nearest neighbour below.
        expect(select).toHaveValue('0');
    });

    it('still gives a stepped parameter with no declared legal set the knob', () => {
        // Presence pin: without this the select branch could have swallowed
        // every `int` parameter and these cases would still pass.
        const stepped = getPluginById('crust')?.parameters.find((candidate) => candidate.id === 'scHpfFreq');
        expect(stepped?.type).toBe('int');
        expect(stepped?.legalSet).toBeUndefined();

        render(
            <DeviceParameterControl param={stepped as DeviceParameterView} device={crustDevice} trackId="track-1" />
        );
        expect(screen.getByTestId('rotary-knob')).toBeInTheDocument();
        expect(screen.queryByTestId('compact-select')).not.toBeInTheDocument();
    });

    it('should render bipolar slider for dB unit parameters', () => {
        const dbParam: DeviceParameterView = {
            ...mockParam,
            unit: 'dB',
        };
        render(<DeviceParameterControl param={dbParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByRole('slider', { name: 'Gain' })).toBeInTheDocument();
    });

    it('should render MIDI learn button', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByTestId('midi-learn-btn')).toBeInTheDocument();
    });

    it('should render automation button for automatable parameters', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByLabelText(/Automate Gain/i)).toBeInTheDocument();
    });

    it('should call addAutomationLane when automation button is clicked without active lane', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        fireEvent.click(screen.getByLabelText(/Automate Gain/i));
        expect(mockAddAutomationLane).toHaveBeenCalledWith('track-1', 'device-1:gain', 'Gain');
    });

    it('should call removeAutomationLane when automation button is clicked with active lane', () => {
        useAutomationLanes([{ id: 'lane-1', trackId: 'track-1', parameterId: 'device-1:gain' }]);
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        fireEvent.click(screen.getByLabelText(/Automate Gain/i));
        expect(mockRemoveAutomationLane).toHaveBeenCalledWith('lane-1');
    });

    it('adds track automation instead of removing a matching clip lane', () => {
        useAutomationLanes([{ id: 'clip-lane', trackId: 'track-1', clipId: 'clip-1', parameterId: 'device-1:gain' }]);

        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        fireEvent.click(screen.getByLabelText(/Automate Gain/i));

        expect(mockRemoveAutomationLane).not.toHaveBeenCalled();
        expect(mockAddAutomationLane).toHaveBeenCalledWith('track-1', 'device-1:gain', 'Gain');
    });

    it('creates Inspector menu automation with the stable id of a legacy-named built-in', () => {
        const track: Track = {
            id: 'track-1',
            name: 'Test Track',
            kind: 'audio',
            muted: false,
            soloed: false,
            armed: false,
            gain: 1,
            pan: 0,
            color: '#ff0000',
            clips: [],
            devices: [{ id: 'device-1', name: 'Crumbs', type: 'cRuMbS', bypassed: false, parameterValues: {} }],
            midiFx: [],
            sends: [],
            frozen: false,
            freezeState: { status: 'unfrozen' },
            parentId: null,
            collapsed: false,
            inputMonitoring: 'auto',
            hidden: false,
            disabled: false,
            height: 100,
            outputId: 'master',
            automationMode: 'read',
            groupId: null,
            soloSafe: false,
            notes: '',
            inputId: null,
            activeAlternativeId: 'alt-1',
            alternatives: [],
            vcaGroupId: null,
            midiOutputTrackId: null,
            followChordTrack: false,
        };
        render(<TrackAutomationSection track={track} />);

        fireEvent.click(screen.getByLabelText('Add automation lane'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Tune' }));

        expect(mockAddAutomationLane).toHaveBeenCalledWith('track-1', 'device-1:tune', 'Crumbs: Tune');
    });

    it('should not render automation button for non-automatable parameters', () => {
        const nonAutoParam: DeviceParameterView = { ...mockParam, automatable: false };
        render(<DeviceParameterControl param={nonAutoParam} device={mockDevice} trackId="track-1" />);
        expect(screen.queryByLabelText(/Automate/i)).not.toBeInTheDocument();
    });

    it('should display unit in value display', () => {
        const unitParam: DeviceParameterView = { ...mockParam, unit: '%' };
        render(<DeviceParameterControl param={unitParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByText(/%/)).toBeInTheDocument();
    });
});
