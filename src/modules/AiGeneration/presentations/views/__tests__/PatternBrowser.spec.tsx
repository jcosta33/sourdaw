import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PatternBrowser } from '../PatternBrowser';

type TrackStoreSubscribe = (typeof import('#/modules/Arrangement/stores'))['trackStore']['subscribe'];

// Mock external dependencies
vi.mock('../../../useCases/patternQueries/PATTERN_TEMPLATES', () => ({
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
}));

vi.mock('../../../useCases/patternQueries/filterTemplates', () => ({
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
        return templates.filter((time) => {
            if (category && time.category !== category) {
                return false;
            }
            if (query && !time.name.toLowerCase().includes(query.toLowerCase())) {
                return false;
            }
            return true;
        });
    }),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn<TrackStoreSubscribe>((_callback) => () => {}),
    },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addClip: vi.fn(() => ({ id: 'clip1', name: 'New Clip' })),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addMidiNote: vi.fn(),
    batchAddMidiNotes: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    getTransportState: vi.fn(() => ({ playheadPosition: 0 })),
}));

vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
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
