import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ScoringPanel } from '../ScoringPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, _defaultValue) => {
        // Return a mock state for scoringStore
        return {
            'device-123': {
                noteName: 'A',
                octave: 4,
                cents: 0,
                confidence: 0.95,
                active: true,
                mode: 'needle',
                a4Reference: 440,
                frequency: 440,
            },
        };
    }),
}));

vi.mock('../../../stores/scoringStore', () => ({
    scoringStore: { name: 'scoringStore' },
    getScoringState: vi.fn((_deviceId) => ({
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

vi.mock('../../../useCases/setDisplayMode', () => ({
    setDisplayMode: vi.fn(),
}));

vi.mock('../../../useCases/setA4Reference', () => ({
    setA4Reference: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawPluginLed', () => ({
    DawPluginLed: ({ children }: { children: React.ReactNode }) => <span data-testid="daw-plugin-led">{children}</span>,
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
    DawPluginSectionCard: ({ title, children, detail }: any) => (
        <div data-testid="section-card">
            <h3>{title}</h3>
            <div>{detail}</div>
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

    it('should render display mode buttons', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Needle')).toBeInTheDocument();
        expect(screen.getByText('Strobe')).toBeInTheDocument();
        expect(screen.getByText('Poly')).toBeInTheDocument();
    });

    it('should render reference section with knob', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        // Get all "Reference" texts and check that at least one exists
        expect(screen.getAllByText(/Reference/i).length).toBeGreaterThan(0);
        expect(screen.getByTestId('rotary-knob')).toBeInTheDocument();
    });

    it('should display current note when active', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should render metric tiles', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getAllByText('Cents').length).toBeGreaterThan(0);
        expect(screen.getByText('Pitch')).toBeInTheDocument();
        expect(screen.getByText('Conf')).toBeInTheDocument();
    });

    it('should display cents value', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        // We look for +0.0 or 0.0 or just 0
        expect(screen.getAllByText(/\+?0\.0/).length).toBeGreaterThan(0);
    });

    it('should display confidence value', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('95%')).toBeInTheDocument();
    });

    it('should render section cards', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Display')).toBeInTheDocument();
        expect(screen.getAllByText(/Reference/i).length).toBeGreaterThan(0);
    });

    it('should render guide section', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Guide')).toBeInTheDocument();
        expect(screen.getByText('Tight zone')).toBeInTheDocument();
        expect(screen.getByText('Usable zone')).toBeInTheDocument();
    });

    it('should render quick read section', () => {
        render(<ScoringPanel deviceId={mockDeviceId} />);
        expect(screen.getByText('Quick read')).toBeInTheDocument();
    });
});
