import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LevainPanel } from './LevainPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        patch: {
            instrumentId: 'violin-1',
            instrumentFamily: 'Strings',
            articulations: [],
            currentArticulation: '',
            expression: {},
            legato: { enabled: false },
            humanize: { amount: 0 },
            micPositions: [],
            macros: [],
            macroLabels: [],
            masterGain: 0.8,
            releaseTriggers: { enabled: false, dynamicScale: false },
        },
        uiLevel: 1,
        engineReady: true,
        sampleLoadProgress: null,
        activeVoices: 0,
        peakL: 0,
        peakR: 0,
        currentArticulationDisplay: 'Long',
    })),
}));

vi.mock('../../stores/levainStore', () => ({
    levainStore: { name: 'levainStore', value: null },
    setCurrentArticulation: vi.fn(),
    updateMicPosition: vi.fn(),
}));

vi.mock('../../useCases/loadPreset', () => ({
    loadInstrument: vi.fn(),
}));

vi.mock('../../useCases/levainParamBridge', () => ({
    sendMicParamToEngine: vi.fn(),
    setLevainParamWithAudio: vi.fn(),
    setMacroWithAudio: vi.fn(),
}));

// Mock UI components and sub-components
vi.mock('#/components/daw/DawPluginChip', () => ({
    DawPluginChip: ({ children, active, onClick }: any) => (
        <button onClick={onClick} data-active={active} data-testid="daw-plugin-chip">
            {children}
        </button>
    ),
}));

vi.mock('#/components/daw/DawPluginLed', () => ({
    DawPluginLed: ({ children }: { children: React.ReactNode }) => (
        <span data-testid="daw-plugin-led">{children}</span>
    ),
}));

vi.mock('#/components/daw/DawPluginMetricTile', () => ({
    DawPluginMetricTile: ({ label, value }: any) => (
        <div data-testid="metric-tile">
            <span>{label}</span>
            <span>{value}</span>
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

vi.mock('#/components/daw/DawReadoutRow', () => ({
    DawReadoutRow: ({ label, value }: any) => (
        <div data-testid="readout-row">
            <span>{label}</span>
            <span>{value}</span>
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

vi.mock('../components/ArticulationList', () => ({
    ArticulationList: () => <div data-testid="articulation-list">Articulation List</div>,
}));

vi.mock('../components/ExpressionPanel', () => ({
    ExpressionPanel: () => <div data-testid="expression-panel">Expression Panel</div>,
}));

vi.mock('../components/HumanizePanel', () => ({
    HumanizePanel: () => <div data-testid="humanize-panel">Humanize Panel</div>,
}));

vi.mock('../components/LegatoTuning', () => ({
    LegatoTuning: () => <div data-testid="legato-tuning">Legato Tuning</div>,
}));

vi.mock('../components/LevainMacroStrip', () => ({
    LevainMacroStrip: () => <div data-testid="macro-strip">Macro Strip</div>,
}));

vi.mock('../components/MicBlendSlider', () => ({
    MicBlendSlider: () => <div data-testid="mic-blend-slider">Mic Blend Slider</div>,
}));

describe('LevainPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<LevainPanel />);
        expect(screen.getByText(/Levain/i)).toBeInTheDocument();
    });

    it('should render instrument list', () => {
        render(<LevainPanel />);
        expect(screen.getByPlaceholderText(/Find a section/i)).toBeInTheDocument();
    });

    it('should render family filter chips', () => {
        render(<LevainPanel />);
        expect(screen.getByText('All')).toBeInTheDocument();
        expect(screen.getByText('Strings')).toBeInTheDocument();
        expect(screen.getByText('Brass')).toBeInTheDocument();
    });

    it('should render section cards', () => {
        render(<LevainPanel />);
        expect(screen.getAllByTestId('section-card').length).toBeGreaterThan(0);
    });

    it('should render articulation list', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('articulation-list')).toBeInTheDocument();
    });

    it('should render expression panel', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('expression-panel')).toBeInTheDocument();
    });

    it('should render humanize panel', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('humanize-panel')).toBeInTheDocument();
    });

    it('should render legato tuning', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('legato-tuning')).toBeInTheDocument();
    });

    it('should render mic blend slider', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('mic-blend-slider')).toBeInTheDocument();
    });

    it('should render macro strip', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('macro-strip')).toBeInTheDocument();
    });

    it('should render master gain knob', () => {
        render(<LevainPanel />);
        expect(screen.getAllByTestId('rotary-knob').length).toBeGreaterThan(0);
    });

    it('should display engine status', () => {
        render(<LevainPanel />);
        expect(screen.getByTestId('daw-plugin-led')).toBeInTheDocument();
    });
});
