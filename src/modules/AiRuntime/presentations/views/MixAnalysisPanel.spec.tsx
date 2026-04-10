import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MixAnalysisPanel } from './MixAnalysisPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        result: null,
        isAnalyzing: false,
        panelOpen: true,
    })),
}));

vi.mock('#/modules/AiRuntime/stores/mixAnalysisStore', () => ({
    mixAnalysisStore: { name: 'mixAnalysisStore' },
    toggleMixAnalysisPanel: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/aiPanelActions', () => ({
    runAppAction: vi.fn(),
}));

vi.mock('../components/mixAnalysis/MixAnalysisSections', () => ({
    OverallLevel: ({ level }: any) => <div data-testid="overall-level">Level: {level}</div>,
    FrequencyBalance: ({ bands }: any) => <div data-testid="freq-balance">Bands: {bands?.length || 0}</div>,
    TrackLevelsList: ({ trackLevels }: any) => <div data-testid="track-levels">Tracks: {trackLevels?.length || 0}</div>,
    IssuesList: ({ issues }: any) => <div data-testid="issues-list">Issues: {issues?.length || 0}</div>,
    SuggestionsList: ({ suggestions }: any) => <div data-testid="suggestions-list">Suggestions: {suggestions?.length || 0}</div>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { toggleMixAnalysisPanel } = await import('#/modules/AiRuntime/stores/mixAnalysisStore');
const { runAppAction } = await import('#/modules/AiRuntime/useCases/aiPanelActions');

// Mock store state
const mockState = {
    result: null as unknown,
    isAnalyzing: false,
    panelOpen: true,
};

(useStore as ReturnType<typeof vi.fn>).mockImplementation(() => mockState);

describe('MixAnalysisPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockState.result = null;
        mockState.isAnalyzing = false;
        mockState.panelOpen = true;
    });

    it('should render without crashing when panel is open', () => {
        const { container } = render(<MixAnalysisPanel />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should return null when panel is closed', () => {
        mockState.panelOpen = false;
        const { container } = render(<MixAnalysisPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('should render "Mix Analysis" title', () => {
        render(<MixAnalysisPanel />);
        expect(screen.getByText('Mix Analysis')).toBeInTheDocument();
    });

    it('should render empty state when no analysis', () => {
        render(<MixAnalysisPanel />);
        expect(screen.getByText('No mix analysis yet')).toBeInTheDocument();
        expect(screen.getByText('Run analysis to inspect the current mix.')).toBeInTheDocument();
    });

    it('should render analyzing state', () => {
        mockState.isAnalyzing = true;
        render(<MixAnalysisPanel />);
        expect(screen.getByText('Analyzing mix...')).toBeInTheDocument();
    });

    it('should call runAppAction with analyzeMix when refresh button is clicked', () => {
        render(<MixAnalysisPanel />);
        const refreshButton = screen.getByLabelText('Refresh mix analysis');
        fireEvent.click(refreshButton);
        expect(runAppAction).toHaveBeenCalledWith({ type: 'analyzeMix' });
    });

    it('should call toggleMixAnalysisPanel when close button is clicked', () => {
        render(<MixAnalysisPanel />);
        const closeButton = screen.getByLabelText('Close mix analysis');
        fireEvent.click(closeButton);
        expect(toggleMixAnalysisPanel).toHaveBeenCalled();
    });

    it('should render analysis results when available', () => {
        mockState.result = {
            overallLevel: -12,
            frequencyBalance: [{ freq: 100, level: -20 }],
            trackLevels: [{ trackId: 't1', level: -10 }],
            issues: [{ severity: 'warning', message: 'Clipping detected' }],
            suggestions: ['Reduce bass level'],
            timestamp: Date.now(),
        };
        render(<MixAnalysisPanel />);
        expect(screen.getByTestId('overall-level')).toBeInTheDocument();
        expect(screen.getByTestId('freq-balance')).toBeInTheDocument();
        expect(screen.getByTestId('track-levels')).toBeInTheDocument();
        expect(screen.getByTestId('issues-list')).toBeInTheDocument();
        expect(screen.getByTestId('suggestions-list')).toBeInTheDocument();
    });

    it('should call runAppAction with autoFixMix when auto-fix button is clicked', () => {
        mockState.result = {
            overallLevel: -12,
            frequencyBalance: [],
            trackLevels: [],
            issues: [{ severity: 'warning', message: 'Test issue' }],
            suggestions: [],
            timestamp: Date.now(),
        };
        render(<MixAnalysisPanel />);
        const autoFixButton = screen.getByText('Auto-Fix');
        fireEvent.click(autoFixButton);
        expect(runAppAction).toHaveBeenCalledWith({ type: 'autoFixMix' });
    });
});
