import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GenerativeAiPanel } from './GenerativeAiPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('#/helpers/tauriBridge', () => ({
    isTauri: vi.fn(() => false),
}));

vi.mock('#/modules/AiGeneration/stores/aiStore', () => ({
    aiStore: {},
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: {},
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: {},
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('#/modules/AiGeneration/useCases/actions/toggleAiPanel', () => ({
    toggleAiPanel: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleGenerateMidiPrompt', () => ({
    handleGenerateMidiPrompt: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleGenerateAudioFallback', () => ({
    handleGenerateAudioFallback: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleStemSeparationPreview', () => ({
    handleStemSeparationPreview: vi.fn(),
}));

vi.mock('../components/AiTaskResultCard', () => ({
    AiTaskResultCard: ({ task }: any) => <div data-testid="task-card">{task.id}</div>,
}));

vi.mock('../components/GenerativeParamGrids', () => ({
    GenreGrid: ({ value, onChange }: any) => (
        <button onClick={() => onChange('Rock')} data-testid="genre-grid">
            Genre: {value || 'None'}
        </button>
    ),
    MoodGrid: ({ value, onChange }: any) => (
        <button onClick={() => onChange('Happy')} data-testid="mood-grid">
            Mood: {value || 'None'}
        </button>
    ),
    InstrumentGrid: ({ value, onChange }: any) => (
        <button onClick={() => onChange('Piano')} data-testid="instrument-grid">
            Instrument: {value || 'None'}
        </button>
    ),
}));

vi.mock('./PatternBrowser', () => ({
    PatternBrowser: () => <div data-testid="pattern-browser">Pattern Browser</div>,
}));

// Mock store states
let mockAiState = { isPanelOpen: true, tasks: [] };
let mockWorkspaceState = { selectedClipId: null };
let mockTrackState = { tracks: [] };

vi.mocked(vi.importMock('#/infra/store/useStore').useStore).mockImplementation((store) => {
    if (store === vi.importMock('#/modules/AiGeneration/stores/aiStore').aiStore) {
        return mockAiState;
    }
    if (store === vi.importMock('#/modules/Workspace/stores/workspaceStore').workspaceStore) {
        return mockWorkspaceState;
    }
    if (store === vi.importMock('#/modules/Arrangement/stores/trackStore').trackStore) {
        return mockTrackState;
    }
    return {};
});

describe('GenerativeAiPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAiState = { isPanelOpen: true, tasks: [] };
        mockWorkspaceState = { selectedClipId: null };
        mockTrackState = { tracks: [] };
    });

    it('should render without crashing when panel is open', () => {
        const { container } = render(<GenerativeAiPanel />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should return null when panel is closed', () => {
        mockAiState = { isPanelOpen: false, tasks: [] };
        const { container } = render(<GenerativeAiPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('should render "Generate" header', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByText('Generate')).toBeInTheDocument();
    });

    it('should render tab buttons', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByText('MIDI')).toBeInTheDocument();
        expect(screen.getByText('Audio')).toBeInTheDocument();
        expect(screen.getByText('Stems')).toBeInTheDocument();
    });

    it('should switch between tabs when clicked', () => {
        render(<GenerativeAiPanel />);
        
        const audioTab = screen.getByText('Audio');
        fireEvent.click(audioTab);
        expect(audioTab.closest('button')).toHaveAttribute('data-state', 'active');
        
        const stemsTab = screen.getByText('Stems');
        fireEvent.click(stemsTab);
        expect(stemsTab.closest('button')).toHaveAttribute('data-state', 'active');
    });

    it('should render PatternBrowser by default in MIDI tab', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByTestId('pattern-browser')).toBeInTheDocument();
    });

    it('should show desktop-only notice for audio generation in browser', () => {
        render(<GenerativeAiPanel />);
        const audioTab = screen.getByText('Audio');
        fireEvent.click(audioTab);
        expect(screen.getByText(/requires the Sourdaw desktop app/)).toBeInTheDocument();
    });

    it('should close panel when X button is clicked', () => {
        const { toggleAiPanel } = vi.importMock('#/modules/AiGeneration/useCases/actions/toggleAiPanel');
        render(<GenerativeAiPanel />);
        const closeButton = screen.getByRole('button', { name: /close/i });
        fireEvent.click(closeButton);
        expect(toggleAiPanel).toHaveBeenCalled();
    });

    it('should render sub-tabs for MIDI', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByText('Patterns')).toBeInTheDocument();
        expect(screen.getByText('AI')).toBeInTheDocument();
    });

    it('should switch to AI sub-tab when clicked', () => {
        render(<GenerativeAiPanel />);
        const aiTab = screen.getByText('AI');
        fireEvent.click(aiTab);
        expect(screen.getByText('Describe the Music')).toBeInTheDocument();
    });
});
