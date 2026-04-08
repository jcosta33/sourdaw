import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScoringPanel } from './ScoringPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        noteName: 'A',
        octave: 4,
        cents: 0,
        confidence: 0.95,
        active: true,
        mode: 'needle',
        a4Reference: 440,
        frequency: 440,
    })),
}));

vi.mock('../../stores/scoringStore', () => ({
    scoringStore: { name: 'scoringStore' },
    getScoringState: vi.fn(() => ({
        noteName: 'A',
        octave: 4,
        cents: 0,
        confidence: 0.95,
        active: true,
        mode: 'needle',
        a4Reference: 440,
        frequency: 440,
    })),
}));

vi.mock('../../useCases/setDisplayMode', () => ({
    setDisplayMode: vi.fn(),
}));

vi.mock('../../useCases/setA4Reference', () => ({
    setA4Reference: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawPluginLed', () => ({
    DawPluginLed: ({ children }: { children: React.ReactNode }) => (
        <span data-testid="daw-plugin-led">{children}</span>
    ),
}));

vi.mock('#/components/daw/DawPluginMetricTile', () => ({
    DawPluginMetricTile: ({ label, value, detail }: any) => (
        <div data-testid="metric-tile">
            <span>{label}</span>
            <span>{value}</span>
            <span>{detail}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawPluginSectionCard', () => ({
    DawPluginSectionCard: ({ title, children }: any) => (
        <div data-testid="section-card">
            <h3>{title}</h3>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange }: any) => (
        <input 
            type="range" 
            value={value} 
            onChange={(e) => onChange(Number(e.target.value))}
            data-testid="rotary-knob"
        />
    ),
}));

describe('ScoringPanel', () => {
    const mockDeviceId = 'device-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Scoring/i)).toBeInTheDocument();
    });

    it('should display tuning deck header', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Tuning deck/i)).toBeInTheDocument();
    });

    it('should render display mode buttons', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Needle/i)).toBeInTheDocument();
        expect(screen.getByText(/Strobe/i)).toBeInTheDocument();
        expect(screen.getByText(/Poly/i)).toBeInTheDocument();
    });

    it('should render reference section with knob', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Reference/i)).toBeInTheDocument();
        expect(screen.getByTestId('rotary-knob')).toBeInTheDocument();
    });

    it('should display current note when active', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('A4')).toBeInTheDocument();
    });

    it('should render metric tiles', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        const metricTiles = screen.getAllByTestId('metric-tile');
        expect(metricTiles.length).toBeGreaterThan(0);
    });

    it('should display cents value', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Cents/i)).toBeInTheDocument();
    });

    it('should display pitch value', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Pitch/i)).toBeInTheDocument();
    });

    it('should display confidence value', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Conf/i)).toBeInTheDocument();
    });

    it('should render section cards', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getAllByTestId('section-card').length).toBeGreaterThan(0);
    });

    it('should render guide section', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Guide/i)).toBeInTheDocument();
    });

    it('should render quick read section', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText(/Quick read/i)).toBeInTheDocument();
    });
});
