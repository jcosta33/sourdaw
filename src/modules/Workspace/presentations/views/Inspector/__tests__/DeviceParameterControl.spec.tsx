import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceParameterControl } from '../DeviceParameterControl';
import type { DeviceParameterView } from '../../../../models/PluginDescriptorViewTypes';
import type { Device } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockSetDeviceParameter = vi.fn();
vi.mock('#/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: (...args: unknown[]) => mockSetDeviceParameter(...args),
}));

const mockAddAutomationLane = vi.fn();
vi.mock('#/modules/Automation/useCases/automation/addAutomationLane', () => ({
    addAutomationLane: (...args: unknown[]) => mockAddAutomationLane(...args),
}));

const mockRemoveAutomationLane = vi.fn();
vi.mock('#/modules/Automation/useCases/automation/removeAutomationLane', () => ({
    removeAutomationLane: (...args: unknown[]) => mockRemoveAutomationLane(...args),
}));

const mockUseStore = vi.fn((store: any, defaultState: any) => defaultState);
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: { id: 'automation' },
}));

vi.mock('#/modules/Automation/stores/modulationStore', () => ({
    modulationStore: { id: 'modulation' },
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

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({
        value,
        onChange,
    }: {
        value: number;
        onChange: (v: number) => void;
    }) => (
        <button data-testid="rotary-knob" data-value={value} onClick={() => onChange(value + 1)}>
            Knob
        </button>
    ),
}));

vi.mock('#/components/ui/bipolar-slider', () => ({
    BipolarSlider: ({
        value,
        onValueChange,
    }: {
        value: number;
        onValueChange: (v: number) => void;
    }) => (
        <input
            type="range"
            data-testid="bipolar-slider"
            value={value}
            onChange={(e) => onValueChange(Number(e.target.value))}
        />
    ),
}));

vi.mock('#/modules/Arrangement/presentations/views/MidiLearnButton', () => ({
    MidiLearnButton: () => <button data-testid="midi-learn-btn">Learn</button>,
}));

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
        mockUseStore.mockImplementation((store: any, defaultState: any) => defaultState);
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
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByText('0.50')).toBeInTheDocument();
    });

    it('should render rotary knob for float parameters', () => {
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByTestId('rotary-knob')).toBeInTheDocument();
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

    it('should render bipolar slider for dB unit parameters', () => {
        const dbParam: DeviceParameterView = {
            ...mockParam,
            unit: 'dB',
        };
        render(<DeviceParameterControl param={dbParam} device={mockDevice} trackId="track-1" />);
        expect(screen.getByTestId('bipolar-slider')).toBeInTheDocument();
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
        expect(mockAddAutomationLane).toHaveBeenCalledWith('track-1', 'gain', 'Gain');
    });

    it('should call removeAutomationLane when automation button is clicked with active lane', () => {
        mockUseStore.mockImplementation((store: any, defaultState: any) => {
            if (store.id === 'automation') {
                return {
                    lanes: [
                        { id: 'lane-1', trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', visible: true },
                    ],
                };
            }
            return defaultState;
        });
        render(<DeviceParameterControl param={mockParam} device={mockDevice} trackId="track-1" />);
        fireEvent.click(screen.getByLabelText(/Automate Gain/i));
        expect(mockRemoveAutomationLane).toHaveBeenCalledWith('lane-1');
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
