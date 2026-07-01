import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GenerativeAiPanel } from '../GenerativeAiPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>();

    return {
        ...actual,
        isAudioGenerationAvailable: vi.fn(() => false),
    };
});

vi.mock('#/modules/AiGeneration/stores/aiStore', () => ({
    aiStore: { name: 'aiStore' },
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: { name: 'workspaceStore' },
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { name: 'trackStore' },
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

vi.mock('../../components/AiTaskResultCard', () => ({
    AiTaskResultCard: ({ task }: any) => <div data-testid="task-card">{task.id}</div>,
}));

vi.mock('../../components/GenerativeParamGrids', () => ({
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

vi.mock('../PatternBrowser', () => ({
    PatternBrowser: () => <div data-testid="pattern-browser">Pattern Browser</div>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { isAudioGenerationAvailable } = await import('#/modules/AudioAnalysis/useCases');

// Mock store states
const mockAiState = { isPanelOpen: true, tasks: [] };
const mockWorkspaceState = { selectedClipId: null };
const mockTrackState = { tracks: [] };

vi.mocked(useStore).mockImplementation((store: any) => {
    if (store?.name === 'aiStore') {
        return mockAiState;
    }
    if (store?.name === 'workspaceStore') {
        return mockWorkspaceState;
    }
    if (store?.name === 'trackStore') {
        return mockTrackState;
    }
    return {};
});

describe('GenerativeAiPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isAudioGenerationAvailable).mockReturnValue(false);
        mockAiState.isPanelOpen = true;
        mockAiState.tasks = [];
        mockWorkspaceState.selectedClipId = null;
        mockTrackState.tracks = [];
    });

    it('should render without crashing when panel is open', () => {
        const { container } = render(<GenerativeAiPanel />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should return null when panel is closed', () => {
        mockAiState.isPanelOpen = false;
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
        expect(screen.getByText(/requires the Sourdaw desktop app/i)).toBeInTheDocument();

        const stemsTab = screen.getByText('Stems');
        fireEvent.click(stemsTab);
        // Use getAllByText and check length
        expect(screen.getAllByText(/Select an audio clip on the timeline/i).length).toBeGreaterThan(0);
    });

    it('should render desktop-only notice when audio generation is unavailable', () => {
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByText('Audio'));

        expect(screen.getByText(/requires the Sourdaw desktop app/i)).toBeInTheDocument();
        expect(screen.queryByText('Describe the Sound')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /generate audio/i })).not.toBeInTheDocument();
    });

    it('should render audio prompt controls when audio generation is available', () => {
        vi.mocked(isAudioGenerationAvailable).mockReturnValue(true);

        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByText('Audio'));

        expect(screen.queryByText(/requires the Sourdaw desktop app/i)).not.toBeInTheDocument();
        expect(screen.getByText('Describe the Sound')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /generate audio/i })).toBeInTheDocument();
    });

    it('should render PatternBrowser by default in MIDI tab', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByTestId('pattern-browser')).toBeInTheDocument();
    });

    it('should close panel when X button is clicked', async () => {
        const { toggleAiPanel } = await import('#/modules/AiGeneration/useCases/actions/toggleAiPanel');
        render(<GenerativeAiPanel />);
        const closeButton = screen.getAllByRole('button')[0];
        fireEvent.click(closeButton!);
        expect(toggleAiPanel).toHaveBeenCalled();
    });

    it('should switch to AI sub-tab when clicked', () => {
        render(<GenerativeAiPanel />);
        const aiTab = screen.getByText('AI');
        fireEvent.click(aiTab);
        expect(screen.getByText('Describe the Music')).toBeInTheDocument();
    });
});
