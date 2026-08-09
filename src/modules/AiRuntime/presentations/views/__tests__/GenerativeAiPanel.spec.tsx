import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GenerativeAiPanel } from '../GenerativeAiPanel';

const { removeTaskMock } = vi.hoisted(() => ({ removeTaskMock: vi.fn() }));

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/AiGeneration/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiGeneration/useCases')>();

    return {
        ...actual,
        removeTask: removeTaskMock,
        toggleAiPanel: vi.fn(),
        handleGenerateMidiPrompt: vi.fn(),
        handleGenerateAudioFallback: vi.fn(),
        handleStemSeparationPreview: vi.fn(),
    };
});

vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>();

    return {
        ...actual,
        isAudioGenerationAvailable: vi.fn(() => false),
    };
});

vi.mock('#/modules/AiGeneration/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiGeneration/stores')>()),
    aiStore: { name: 'aiStore' },
}));

vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/stores')>()),
    workspaceStore: { name: 'workspaceStore' },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { name: 'trackStore' },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { tempo: 120 } },
}));

type MockAiTask = {
    id: string;
};

type MockAiTaskResultCardProps = {
    task: MockAiTask;
    onRemove: (taskId: string) => void;
};

vi.mock('../../components/AiTaskResultCard', () => ({
    AiTaskResultCard: ({ task, onRemove }: MockAiTaskResultCardProps) => (
        <button type="button" data-testid="task-card" onClick={() => onRemove(task.id)}>
            Remove task {task.id}
        </button>
    ),
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

// Spread `importOriginal` so a view added to the AiGeneration barrel later does
// not resolve to `undefined` here and red every render in this file (#1393).
vi.mock('#/modules/AiGeneration/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiGeneration/presentations/views')>()),
    PatternBrowser: () => <div data-testid="pattern-browser">Pattern Browser</div>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { isAudioGenerationAvailable } = await import('#/modules/AudioAnalysis/useCases');

// Mock store states
type MockAiTaskState = {
    id: string;
    type: 'audio-generation';
    status: 'success';
    timestamp: number;
};

const mockAiState: { isPanelOpen: boolean; tasks: MockAiTaskState[] } = { isPanelOpen: true, tasks: [] };
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

    it('should route task removal through the owning use case', () => {
        mockAiState.tasks = [{ id: 'task-1', type: 'audio-generation', status: 'success', timestamp: 1 }];
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove task task-1' }));

        expect(removeTaskMock).toHaveBeenCalledWith('task-1');
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
        const { toggleAiPanel } = await import('#/modules/AiGeneration/useCases');
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
