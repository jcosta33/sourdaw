import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PatternBrowser } from '../PatternBrowser';

// Mock external dependencies
vi.mock('../../../models/midiPatternLibrary', () => ({
    PATTERN_CATEGORIES: [
        { id: 'chords', label: 'Chords' },
        { id: 'bass', label: 'Bass' },
        { id: 'drums', label: 'Drums' },
        { id: 'melody', label: 'Melody' },
    ],
    PATTERN_TEMPLATES: [
        {
            id: 't1',
            name: 'Test Pattern',
            category: 'chords',
            genres: [],
            tags: [],
            lengthBeats: 4,
            description: 'A test pattern',
            generate: vi.fn(() => [{ pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }]),
        },
    ],
    ALL_KEYS: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    SCALE_TYPES: ['major', 'minor'],
    SCALE_LABELS: { major: 'Major', minor: 'Minor' },
    ALL_GENRES: [
        { id: 'pop', label: 'Pop' },
        { id: 'rock', label: 'Rock' },
    ],
    filterTemplates: vi.fn(({ query, category }: { query?: string; category?: string }) => {
        const templates = [
            {
                id: 't1',
                name: 'Test Pattern',
                category: 'chords',
                lengthBeats: 4,
                description: 'A test pattern',
                generate: vi.fn(() => [{ pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }]),
            },
        ];
        return templates.filter((t) => {
            if (category && t.category !== category) {
                return false;
            }
            if (query && !t.name.toLowerCase().includes(query.toLowerCase())) {
                return false;
            }
            return true;
        });
    }),
    resolveTemplateScale: vi.fn((_template: unknown, params: { scale: string }) => params.scale),
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [], selectedTrackId: null } },
}));

vi.mock('#/modules/Arrangement/useCases/clip/addClip', () => ({
    addClip: vi.fn(() => ({ id: 'clip1', name: 'New Clip' })),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/addMidiNote', () => ({
    addMidiNote: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiNoteCrud/batchAddMidiNotes', () => ({
    batchAddMidiNotes: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(() => ({ playheadPosition: 0 })),
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/panelToggles/selectClip', () => ({
    selectClip: vi.fn(),
}));

describe('PatternBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<PatternBrowser />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render search input', () => {
        render(<PatternBrowser />);
        expect(screen.getByLabelText('Search MIDI patterns')).toBeInTheDocument();
    });

    it('should render category filter buttons', () => {
        render(<PatternBrowser />);
        expect(screen.getAllByText('All').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Chords/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Bass/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Drums/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Melody/i).length).toBeGreaterThan(0);
    });

    it('should render pattern template cards', () => {
        render(<PatternBrowser />);
        expect(screen.getByText('Test Pattern')).toBeInTheDocument();
    });

    it('should filter patterns by category when clicked', () => {
        render(<PatternBrowser />);
        const chordsButtons = screen.getAllByText(/Chords/i);
        const chordsButton = chordsButtons.find((b) => b.tagName === 'BUTTON');
        fireEvent.click(chordsButton!);
        // Category filter should be applied
        expect(chordsButton).toHaveClass('bg-accent');
    });

    it('should filter patterns by search query', () => {
        render(<PatternBrowser />);
        const searchInput = screen.getByLabelText('Search MIDI patterns');
        fireEvent.change(searchInput, { target: { value: 'Test' } });
        expect(searchInput).toHaveValue('Test');
    });

    it('should show empty state when no patterns match', () => {
        render(<PatternBrowser />);
        const searchInput = screen.getByLabelText('Search MIDI patterns');
        fireEvent.change(searchInput, { target: { value: 'NonExistentPattern12345' } });
        expect(screen.getByText('No patterns match your filters')).toBeInTheDocument();
    });

    it('should render count of filtered patterns', () => {
        render(<PatternBrowser />);
        expect(screen.getByText('1/1')).toBeInTheDocument();
    });
});
