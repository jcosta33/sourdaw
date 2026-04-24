import { describe, it, expect, vi } from 'vitest';

// Mock external dependencies
const { mockRegisterPrefixLayout } = vi.hoisted(() => ({
    mockRegisterPrefixLayout: vi.fn(),
}));
vi.mock('../../deviceLayoutRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../deviceLayoutRegistry')>();
    return {
        ...actual,
        registerPrefixLayout: (...args: unknown[]) => mockRegisterPrefixLayout(...args),
        SectionHeader: ({ title }: { title: string }) => <div data-testid="section-header">{title}</div>,
    };
});

vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: () => <div data-testid="adsr-envelope">ADSR Envelope</div>,
}));

vi.mock('#/components/daw/visualizers/FilterResponse', () => ({
    FilterResponse: () => <div data-testid="filter-response">Filter Response</div>,
}));

vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: () => <div data-testid="compressor-curve">Compressor Curve</div>,
}));

vi.mock('#/components/daw/visualizers/OscillatorWaveform', () => ({
    OscillatorWaveform: () => <div data-testid="oscillator-waveform">Oscillator Waveform</div>,
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

describe('FaustInstrumentLayout', () => {
    it('should register layout for faust- prefix', async () => {
        await import('../FaustInstrumentLayout');
        expect(mockRegisterPrefixLayout).toHaveBeenCalledWith('faust-', expect.any(Function));
    });
});
