import { render, screen, fireEvent, within } from '@testing-library/react';
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
    };
});

vi.mock('#/modules/AiGeneration/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiGeneration/stores')>()),
    aiStore: { name: 'aiStore' },
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

// Spread `importOriginal` so a view added to the AiGeneration barrel later does
// not resolve to `undefined` here and red every render in this file (#1393).
vi.mock('#/modules/AiGeneration/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiGeneration/presentations/views')>()),
    PatternBrowser: () => <div data-testid="pattern-browser">Pattern Browser</div>,
}));

const { useStore } = await import('#/infra/store/useStore');
// Mock store states
type MockAiTaskState = {
    id: string;
    type: 'midi-generation';
    status: 'success';
    timestamp: number;
};

const mockAiState: { isPanelOpen: boolean; tasks: MockAiTaskState[] } = { isPanelOpen: true, tasks: [] };

vi.mocked(useStore).mockImplementation((store: any) => {
    if (store?.name === 'aiStore') {
        return mockAiState;
    }
    return {};
});

describe('GenerativeAiPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAiState.isPanelOpen = true;
        mockAiState.tasks = [];
    });

    it('should render without crashing when panel is open', () => {
        const { container } = render(<GenerativeAiPanel />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should route task removal through the owning use case', () => {
        mockAiState.tasks = [{ id: 'task-1', type: 'midi-generation', status: 'success', timestamp: 1 }];
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

    it('renders only the MIDI generation modes', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByText('Patterns')).toBeInTheDocument();
        expect(screen.getByText('AI')).toBeInTheDocument();
        expect(screen.queryByText('Stems')).not.toBeInTheDocument();
        expect(screen.queryByText('Extract Stems')).not.toBeInTheDocument();
    });

    it('should render PatternBrowser by default in MIDI tab', () => {
        render(<GenerativeAiPanel />);
        expect(screen.getByTestId('pattern-browser')).toBeInTheDocument();
    });

    it('should close panel when X button is clicked', async () => {
        const { toggleAiPanel } = await import('#/modules/AiGeneration/useCases');
        render(<GenerativeAiPanel />);
        const closeButton = screen.getByRole('button', { name: 'Close generate panel' });
        fireEvent.click(closeButton);
        expect(toggleAiPanel).toHaveBeenCalled();
    });

    it('should switch to AI sub-tab when clicked', () => {
        render(<GenerativeAiPanel />);
        const aiTab = screen.getByText('AI');
        fireEvent.click(aiTab);
        expect(screen.getByText('Describe the Music')).toBeInTheDocument();
    });
});

describe('GenerativeAiPanel — option grid semantics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAiState.isPanelOpen = true;
        mockAiState.tasks = [];
    });

    function renderAndSwitchToAi() {
        render(<GenerativeAiPanel />);
        fireEvent.click(screen.getByText('AI'));
    }

    it('AI tab exposes five button options in each grid', () => {
        renderAndSwitchToAi();
        expect(within(screen.getByTestId('genre-grid')).getAllByRole('button')).toHaveLength(5);
        expect(within(screen.getByTestId('mood-grid')).getAllByRole('button')).toHaveLength(5);
        expect(within(screen.getByTestId('instrument-grid')).getAllByRole('button')).toHaveLength(5);
    });

    it('Lo-Fi starts unpressed; selecting enables Generate MIDI and reveals Genre Clear; deselecting reverses both', () => {
        renderAndSwitchToAi();
        const loFi = within(screen.getByTestId('genre-grid')).getByRole('button', { name: 'Lo-Fi' });
        const generateMidi = screen.getByRole('button', { name: /Generate MIDI/ });

        expect(loFi).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
        expect(generateMidi).toBeDisabled();

        fireEvent.click(loFi);
        expect(loFi).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
        expect(generateMidi).toBeEnabled();

        fireEvent.click(loFi);
        expect(loFi).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
        expect(generateMidi).toBeDisabled();
    });

    it('Genre Clear clears the selection', () => {
        renderAndSwitchToAi();
        const loFi = within(screen.getByTestId('genre-grid')).getByRole('button', { name: 'Lo-Fi' });
        fireEvent.click(loFi);
        expect(loFi).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(loFi).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    });

    it('Chill and Drum Kit flip their own pressed states independently', () => {
        renderAndSwitchToAi();
        const chill = within(screen.getByTestId('mood-grid')).getByRole('button', { name: 'Chill' });
        const drumKit = within(screen.getByTestId('instrument-grid')).getByRole('button', { name: 'Drum Kit' });

        fireEvent.click(chill);
        expect(chill).toHaveAttribute('aria-pressed', 'true');
        expect(drumKit).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(drumKit);
        expect(drumKit).toHaveAttribute('aria-pressed', 'true');
        expect(chill).toHaveAttribute('aria-pressed', 'true');
    });
});
