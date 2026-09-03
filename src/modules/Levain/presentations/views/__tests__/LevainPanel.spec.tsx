import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LevainPanel } from '../LevainPanel';

// Mutable state the mocked store returns, keyed by deviceId. Tests tweak it
// before rendering. LevainPanel reads an instances map keyed by deviceId.
type PanelState = Record<string, unknown>;
let panelState: PanelState;

function baseState(): PanelState {
    return {
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
        sampleLoadError: null,
        activeVoices: 0,
        peakL: 0,
        peakR: 0,
        currentArticulationDisplay: 'Long',
    };
}

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({ 'test-device': panelState })),
}));

vi.mock('../../../stores/levainStore', () => ({
    defaultLevainState: { patch: { instrumentId: 'violin-1' } },
    levainStore: { name: 'levainStore', value: null },
    setCurrentArticulation: vi.fn(),
    updateMicPosition: vi.fn(),
}));

vi.mock('../../../useCases/loadPreset', () => ({
    loadInstrument: vi.fn(),
}));

vi.mock('../../../useCases/levainParamBridge/setMacroWithAudio', () => ({
    setMacroWithAudio: vi.fn(),
}));

vi.mock('../../../useCases/levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: vi.fn(),
}));

vi.mock('../../../useCases/levainParamBridge/sendMicParamToEngine', () => ({
    sendMicParamToEngine: vi.fn(),
}));

// Mock UI components. Forward the aria/role props under test so the panel's
// accessibility wiring is observable through the rendered DOM.
vi.mock('#/components/daw/DawPluginChip', () => ({
    DawPluginChip: ({ children, active, onClick, role, ...rest }: any) => (
        <button
            onClick={onClick}
            data-active={active}
            data-testid="daw-plugin-chip"
            role={role}
            aria-checked={rest['aria-checked']}
        >
            {children}
        </button>
    ),
}));

vi.mock('#/components/daw/DawPluginLed', () => ({
    DawPluginLed: ({ children, ...rest }: any) => (
        <span data-testid="daw-plugin-led" aria-live={rest['aria-live']} aria-label={rest['aria-label']}>
            {children}
        </span>
    ),
}));

vi.mock('#/components/daw/DawPluginMetricTile', () => ({
    DawPluginMetricTile: ({ label, value, detail, ...rest }: any) => (
        <div data-testid="metric-tile" aria-live={rest['aria-live']}>
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

vi.mock('../../components/ArticulationList', () => ({
    ArticulationList: () => <div data-testid="articulation-list">Articulation List</div>,
}));

vi.mock('../../components/ExpressionPanel', () => ({
    ExpressionPanel: () => <div data-testid="expression-panel">Expression Panel</div>,
}));

vi.mock('../../components/HumanizePanel', () => ({
    HumanizePanel: () => <div data-testid="humanize-panel">Humanize Panel</div>,
}));

vi.mock('../../components/LegatoTuning', () => ({
    LegatoTuning: () => <div data-testid="legato-tuning">Legato Tuning</div>,
}));

vi.mock('../../components/LevainMacroStrip', () => ({
    LevainMacroStrip: () => <div data-testid="macro-strip">Macro Strip</div>,
}));

vi.mock('../../components/MicBlendSlider', () => ({
    MicBlendSlider: () => <div data-testid="mic-blend-slider">Mic Blend Slider</div>,
}));

describe('LevainPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        panelState = baseState();
    });

    it('should render without crashing', () => {
        render(<LevainPanel deviceId="test-device" />);
        expect(screen.getByText(/Levain/i)).toBeInTheDocument();
    });

    it('should render family filter chips', () => {
        render(<LevainPanel deviceId="test-device" />);
        const chips = screen.getAllByTestId('daw-plugin-chip');
        expect(chips.some((c) => c.textContent === 'Strings')).toBe(true);
    });

    it('should render section cards', () => {
        render(<LevainPanel deviceId="test-device" />);
        expect(screen.getAllByTestId('section-card').length).toBeGreaterThan(0);
    });

    it('should display engine status', () => {
        render(<LevainPanel deviceId="test-device" />);
        const leds = screen.getAllByTestId('daw-plugin-led');
        expect(leds.some((l) => l.textContent === 'Ready')).toBe(true);
    });

    describe('fix 8 — accessibility', () => {
        it('marks the family filter as a radiogroup with radio chips', () => {
            render(<LevainPanel deviceId="test-device" />);
            const group = screen.getByRole('radiogroup', { name: /family/i });
            expect(group).toBeInTheDocument();
            const radios = screen.getAllByRole('radio');
            const allChecked = radios.find((r) => r.getAttribute('aria-checked') === 'true');
            expect(allChecked).toBeTruthy();
        });

        it('marks the active instrument button with aria-current', () => {
            render(<LevainPanel deviceId="test-device" />);
            // violin-1 ("Solo Violin") is active per the default patch.
            const active = screen.getByRole('button', { name: /Solo Violin/i });
            expect(active).toHaveAttribute('aria-current', 'true');
            expect(active).toHaveAttribute('aria-pressed', 'true');
        });

        it('makes the engine-ready LED a live region', () => {
            render(<LevainPanel deviceId="test-device" />);
            const led = screen.getAllByTestId('daw-plugin-led').find((l) => l.textContent === 'Ready');
            expect(led).toHaveAttribute('aria-live', 'polite');
        });

        it('makes the Load tile a live region', () => {
            render(<LevainPanel deviceId="test-device" />);
            const tiles = screen.getAllByTestId('metric-tile');
            const loadTile = tiles.find((t) => t.textContent?.includes('Load'));
            expect(loadTile).toHaveAttribute('aria-live', 'polite');
        });
    });

    describe('fix 4 — dead Voices/peak telemetry widgets removed', () => {
        it('does not render a Voices tile or a "voices" LED', () => {
            render(<LevainPanel deviceId="test-device" />);
            const tiles = screen.getAllByTestId('metric-tile');
            expect(tiles.some((t) => t.textContent?.includes('Voices'))).toBe(false);
            const leds = screen.getAllByTestId('daw-plugin-led');
            expect(leds.some((l) => /voices/i.test(l.textContent ?? ''))).toBe(false);
        });
    });

    describe('fix 10 — instrument subtitle no longer derived from the id', () => {
        it('does not show a dash-stripped id subtitle under the label', () => {
            render(<LevainPanel deviceId="test-device" />);
            // 'violin-1' -> 'violin 1' was the old id-transform subtitle.
            expect(screen.queryByText('violin 1')).not.toBeInTheDocument();
        });
    });

    describe('fix 3 — sample-load error surfaced in the panel', () => {
        it('shows the error instead of a synthetic Ready/percentage', () => {
            panelState = { ...baseState(), sampleLoadError: 'Failed to fetch manifest', sampleLoadProgress: null };
            render(<LevainPanel deviceId="test-device" />);
            const tiles = screen.getAllByTestId('metric-tile');
            const loadTile = tiles.find((t) => t.textContent?.includes('Load'));
            expect(loadTile?.textContent).toContain('Error');
            expect(loadTile?.textContent).toContain('Failed to fetch manifest');
        });
    });

    describe('overflow normalization', () => {
        it('establishes min-height floor and allows bottom drawer scrolling without overflow-hidden', () => {
            const { container } = render(<LevainPanel deviceId="test-device" />);
            const faceplate = container.querySelector<HTMLElement>('.levain-faceplate');
            expect(faceplate).not.toBeNull();
            expect(faceplate?.className).toContain('min-h-[440px]');
            expect(faceplate?.className).not.toContain('overflow-hidden');
        });
    });
});
