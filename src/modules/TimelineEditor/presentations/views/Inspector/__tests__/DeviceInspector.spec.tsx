import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DeviceInspector } from '../DeviceInspector';

import type { Device } from '../../../../models/TrackViewTypes';

// Mock external dependencies
vi.mock('../layouts', () => ({})); // Prevent OOM by not loading all layouts

const mockGetBuiltinPlugins = vi.fn<() => readonly unknown[]>(() => []);
const mockBypassDevice = vi.fn<(deviceId: string, bypassed: boolean) => void>();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getBuiltinPlugins: () => mockGetBuiltinPlugins(),
        bypassDevice: (deviceId: string, bypassed: boolean): void => {
            mockBypassDevice(deviceId, bypassed);
        },
    };
});

const mockResolveDeviceLayout = vi.fn<() => unknown>(() => null);
vi.mock('../deviceLayoutRegistry', () => ({
    resolveDeviceLayout: () => mockResolveDeviceLayout(),
    registerDeviceLayout: vi.fn(),
    registerPrefixLayout: vi.fn(),
    SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
}));

vi.mock('../../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

vi.mock('../../../components/Inspector/InspectorDetailHeader', () => ({
    InspectorDetailHeader: ({
        title,
        onBack,
        actions,
    }: {
        title: React.ReactNode;
        onBack: () => void;
        actions?: React.ReactNode;
    }) => (
        <div data-testid="inspector-header">
            <div data-testid="header-title">{title}</div>
            <button data-testid="back-btn" onClick={onBack}>
                Back
            </button>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/MechanicalSwitch', () => ({
    MechanicalSwitch: ({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) => (
        <button data-testid="mechanical-switch" data-checked={checked} onClick={() => onChange(!checked)}>
            Toggle
        </button>
    ),
}));

vi.mock('../GenericDeviceLayout', () => ({
    GenericDeviceLayout: ({ parameters }: { parameters: ReadonlyArray<{ id: string }> }) => (
        <div
            data-testid="generic-layout"
            data-param-count={parameters.length}
            data-param-ids={parameters.map((parameter) => parameter.id).join(',')}
        >
            Generic Layout
        </div>
    ),
}));

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
    id: 'device-1',
    name: 'Test Device',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: { gain: 0.5, cutoff: 1000 },
    ...overrides,
});

describe('DeviceInspector', () => {
    const mockOnBack = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetBuiltinPlugins.mockReturnValue([]);
        mockResolveDeviceLayout.mockReturnValue(null);
    });

    it('should render without crashing', () => {
        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('inspector-header')).toBeInTheDocument();
    });

    it('should display device name in header', () => {
        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByText('Test Device')).toBeInTheDocument();
    });

    it('should call onBack when back button is clicked', () => {
        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={mockOnBack} />);
        fireEvent.click(screen.getByTestId('back-btn'));
        expect(mockOnBack).toHaveBeenCalledTimes(1);
    });

    it('should reflect a non-bypassed device as a checked switch', () => {
        render(<DeviceInspector device={makeDevice({ bypassed: false })} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('mechanical-switch').getAttribute('data-checked')).toBe('true');
    });

    it('should call bypassDevice with the inverse when the switch is toggled', () => {
        render(<DeviceInspector device={makeDevice({ bypassed: false })} trackId="track-1" onBack={mockOnBack} />);
        fireEvent.click(screen.getByTestId('mechanical-switch'));
        // switch was checked (not bypassed); onChange(false) => bypassDevice(id, !false === true)
        expect(mockBypassDevice).toHaveBeenCalledWith('device-1', true);
    });

    it('should show the empty message when the device has no parameters', () => {
        render(<DeviceInspector device={makeDevice({ parameterValues: {} })} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByText('No parameters available for this device.')).toBeInTheDocument();
        expect(screen.queryByTestId('generic-layout')).not.toBeInTheDocument();
    });

    it('should derive parameters from parameterValues across every heuristic range branch', () => {
        const device = makeDevice({
            parameterValues: {
                volume: 0.8,
                frequency: 440,
                attack: 0.2,
                speed: 4,
                amount: 50,
                drawbar1: 6,
                resonance: 2,
                misc: -5,
            },
        });
        render(<DeviceInspector device={device} trackId="track-1" onBack={mockOnBack} />);
        const layout = screen.getByTestId('generic-layout');
        expect(layout.getAttribute('data-param-count')).toBe('8');
    });

    it('should use the layout component when the registry resolves one', () => {
        mockResolveDeviceLayout.mockReturnValue(({ parameters }: { parameters: ReadonlyArray<{ id: string }> }) => (
            <div data-testid="custom-layout" data-count={parameters.length}>
                Custom
            </div>
        ));
        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('custom-layout')).toBeInTheDocument();
        expect(screen.queryByTestId('generic-layout')).not.toBeInTheDocument();
    });

    it('should prefer a matching builtin plugin descriptor over derived parameters', () => {
        mockGetBuiltinPlugins.mockReturnValue([
            {
                id: 'builtin-synth',
                name: 'Synth',
                parameters: [
                    { id: 'p1', name: 'One', automatable: true },
                    { id: 'p2', name: 'Two', automatable: true },
                ],
            },
        ]);
        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('generic-layout').getAttribute('data-param-count')).toBe('2');
    });

    it('should resolve the declared gain control for a faust-fm-synth device from the real registry', async () => {
        // The fm-synth descriptor declares only `gain`; its op-level controls
        // wait on the FM preset migration. An empty declared `parameters`
        // array is not nullish, so before `gain` was declared the device fell
        // past the derive fallback and the inspector resolved no controls at
        // all — the Faust instrument layout showed its loading message
        // forever. Run against the real registry (the module mock's
        // importActual), not a hand-built descriptor, so the case fails if
        // the descriptor's parameters revert to [].
        const actual = await vi.importActual<typeof import('#/modules/Arrangement/useCases')>(
            '#/modules/Arrangement/useCases'
        );
        mockGetBuiltinPlugins.mockImplementation(actual.getBuiltinPlugins);
        render(
            <DeviceInspector
                device={makeDevice({
                    id: 'device-fm',
                    name: 'FM Synth',
                    type: 'faust-fm-synth',
                    parameterValues: { gain: 0.35 },
                })}
                trackId="track-1"
                onBack={mockOnBack}
            />
        );
        expect(screen.getByTestId('generic-layout').getAttribute('data-param-ids')).toBe('gain');
    });

    it('should match a builtin plugin by display name', () => {
        mockGetBuiltinPlugins.mockReturnValue([
            { id: 'other', name: 'Test Device', parameters: [{ id: 'p1', name: 'One', automatable: true }] },
        ]);
        render(<DeviceInspector device={makeDevice({ type: 'unknown-type' })} trackId="track-1" onBack={mockOnBack} />);
        expect(screen.getByTestId('generic-layout').getAttribute('data-param-count')).toBe('1');
    });
});
