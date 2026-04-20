import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import after mocking
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, compact }: { title?: string; compact?: boolean }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title}
        </div>
    ),
}));

vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: () => <div data-testid="adsr-envelope">ADSR Envelope</div>,
}));

vi.mock('#/components/daw/visualizers/OscillatorWaveform', () => ({
    OscillatorWaveform: () => <div data-testid="oscillator-waveform">Oscillator Waveform</div>,
}));

vi.mock('#/components/daw/visualizers/FilterResponse', () => ({
    FilterResponse: () => <div data-testid="filter-response">Filter Response</div>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { name: string } }) => (
        <div data-testid="param-control">{param.name}</div>
    ),
}));

// Mock the registry functions
const { mockRegisterDeviceLayout } = vi.hoisted(() => ({
    mockRegisterDeviceLayout: vi.fn(),
}));
vi.mock('../../deviceLayoutRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../deviceLayoutRegistry')>();
    return {
        ...actual,
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
        filterParams: (params: unknown[], ids: string[]) =>
            (params as Array<{ id: string }>).filter((p) => ids.includes(p.id)),
    };
});

// Import the component after mocks
describe('BuiltinSynthLayout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should register layout for builtin-synth variants', async () => {
        await import('../BuiltinSynthLayout');
        expect(mockRegisterDeviceLayout).toHaveBeenCalled();
        const [deviceTypes] = mockRegisterDeviceLayout.mock.calls[0];
        expect(deviceTypes).toContain('builtin-synth');
        expect(deviceTypes).toContain('builtin-synth-mellotron');
    });
});
