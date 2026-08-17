import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { addTrack } from '../../../useCases/addTrack';
import { addClip } from '../../../useCases/clip/addClip';
import { removeMarker } from '../../../useCases/marker/markerOperations/removeMarker';
import { setMarkerColor } from '../../../useCases/marker/markerOperations/setMarkerColor';
import { TimelineEmptyMenu } from '../TimelineEmptyMenu';

// Controllable store values so individual tests can seed markers/tracks.
const storeValues = vi.hoisted(() => ({
    track: { tracks: [] as Array<{ id: string; kind: string }> },
    marker: {
        markers: [] as Array<{ id: string; name: string; beat: number; color: string }>,
        sections: [] as unknown[],
    },
}));

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { getSnapshot?: () => unknown; value?: unknown }, defaultValue: unknown) => {
        const snap = typeof store.getSnapshot === 'function' ? store.getSnapshot() : store.value;
        return snap ?? defaultValue;
    }),
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return storeValues.track;
        },
    },
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return storeValues.marker;
        },
    },
    defaultMarkerStoreState: { markers: [], sections: [] },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

const importMidiFileMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../useCases/importMidiFile', () => ({
    importMidiFile: importMidiFileMock,
}));

const decodeAudioFileMock = vi.hoisted(() => vi.fn<() => Promise<{ id: string; buffer: { duration: number } }>>());
vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: decodeAudioFileMock,
}));

vi.mock('../../../useCases/clipboard/pasteClip', () => ({
    pasteClip: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({
    removeMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({
    setMarkerColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({
    addMarker: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

const renderWithTooltip = (ui: ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TimelineEmptyMenu', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId="track1" beat={8} onClose={mockOnClose} />);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render Add Track buttons', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Add Audio Track')).toBeInTheDocument();
        expect(screen.getByText('Add MIDI Track')).toBeInTheDocument();
        expect(screen.getByText('Add Bus Track')).toBeInTheDocument();
    });

    it('should render Add Clip Here when trackId is provided', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId="track1" beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Add Clip Here')).toBeInTheDocument();
    });

    it('should render Paste button', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Paste')).toBeInTheDocument();
    });

    it('should render Add Marker Here button', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Add Marker Here')).toBeInTheDocument();
    });

    it('should render Import buttons', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Import Audio…')).toBeInTheDocument();
        expect(screen.getByText('Import MIDI…')).toBeInTheDocument();
    });

    it('should call addTrack when Add Audio Track is clicked', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        const button = screen.getByText('Add Audio Track');
        fireEvent.click(button);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Audio', kind: 'audio' });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('dispatches bus creation through the canonical app action', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);

        fireEvent.click(screen.getByText('Add Bus Track'));

        expect(executeAppAction).toHaveBeenCalledWith({ type: 'createBus', payload: { name: 'Bus' } });
        expect(addTrack).not.toHaveBeenCalledWith({ name: 'Bus', kind: 'bus' });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when menu item is clicked', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        const button = screen.getByText('Add Audio Track');
        fireEvent.click(button);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should show AI Generate section', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('AI Generate')).toBeInTheDocument();
    });

    it('should have correct positioning', () => {
        renderWithTooltip(<TimelineEmptyMenu x={150} y={200} trackId={null} beat={8} onClose={mockOnClose} />);
        const menu = screen.getByRole('menu');
        expect(menu).toHaveStyle({ left: '150px', top: '200px' });
    });

    it('adds an audio clip on Add Clip Here for a non-midi track', () => {
        storeValues.track = { tracks: [{ id: 't1', kind: 'audio' }] };
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId="t1" beat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Add Clip Here'));
        expect(addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 't1', startBeat: 4, endBeat: 8, type: 'audio', name: 'New audio clip' })
        );
        expect(mockOnClose).toHaveBeenCalled();
        storeValues.track = { tracks: [] };
    });

    it('adds a midi clip on Add Clip Here for a midi track', () => {
        storeValues.track = { tracks: [{ id: 't1', kind: 'midi' }] };
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId="t1" beat={2} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Add Clip Here'));
        expect(addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 't1', startBeat: 2, endBeat: 6, type: 'midi', name: 'New midi clip' })
        );
        storeValues.track = { tracks: [] };
    });

    it('dispatches generate actions with the selected trackId and startBeat', () => {
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId="t1" beat={8} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Generate Drum Pattern'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'generateDrumPattern',
            payload: { style: 'rock', bars: 4, trackId: 't1', startBeat: 8 },
        });
        fireEvent.click(screen.getByText('Generate Chord Progression'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'generateChordProgression',
            payload: expect.objectContaining({ trackId: 't1', startBeat: 8, key: 0, scale: 'major' }),
        });
        fireEvent.click(screen.getByText('Generate Melody'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'generateMelody',
            payload: expect.objectContaining({ trackId: 't1', startBeat: 8 }),
        });
    });

    it('dispatches generate actions with undefined trackId when none is selected', () => {
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Generate Drum Pattern'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'generateDrumPattern',
            payload: { style: 'rock', bars: 4, trackId: undefined, startBeat: 0 },
        });
        // Drive the remaining generators so their `trackId ?? undefined`
        // fallbacks are exercised too.
        fireEvent.click(screen.getByText('Generate Chord Progression'));
        expect(executeAppAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'generateChordProgression',
                payload: expect.objectContaining({ trackId: undefined }),
            })
        );
        fireEvent.click(screen.getByText('Generate Melody'));
        expect(executeAppAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'generateMelody',
                payload: expect.objectContaining({ trackId: undefined }),
            })
        );
    });

    it('renders the nearby marker color/remove controls when a marker is within 2 beats', () => {
        storeValues.marker = {
            markers: [{ id: 'mk1', name: 'Verse', beat: 8, color: '#fff' }],
            sections: [],
        };
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Marker: Verse')).toBeInTheDocument();
        // Remove marker control is present.
        fireEvent.click(screen.getByText('Remove Marker'));
        expect(removeMarker).toHaveBeenCalledWith('mk1');
        expect(mockOnClose).toHaveBeenCalled();
        storeValues.marker = { markers: [], sections: [] };
    });

    it('sets a nearby marker color from a swatch', () => {
        storeValues.marker = {
            markers: [{ id: 'mk1', name: 'Verse', beat: 8, color: '' }],
            sections: [],
        };
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={8} onClose={mockOnClose} />);
        const swatch = screen.getAllByLabelText('Set marker color')[0]!;
        fireEvent.click(swatch);
        expect(setMarkerColor).toHaveBeenCalledWith('mk1', expect.any(String));
        storeValues.marker = { markers: [], sections: [] };
    });

    it('does not render nearby marker controls when no marker is close', () => {
        storeValues.marker = {
            markers: [{ id: 'mk1', name: 'Far', beat: 100, color: '' }],
            sections: [],
        };
        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.queryByText('Marker: Far')).not.toBeInTheDocument();
        storeValues.marker = { markers: [], sections: [] };
    });

    it('imports an audio file into a new track when no trackId is selected', async () => {
        decodeAudioFileMock.mockResolvedValue({
            id: 'buf-1',
            buffer: { duration: 2 },
        });

        // Capture the file input the handler creates so we can drive its onchange.
        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import Audio…'));
        expect(captured).not.toBeNull();
        // Simulate the user picking a file.
        Object.defineProperty(captured!, 'files', {
            value: [new File([], 'loop.wav')],
            configurable: true,
        });
        await captured!.onchange?.(new Event('change'));
        createSpy.mockRestore();

        // No trackId → a new audio track is added, then the clip lands there.
        expect(addTrack).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audio', name: 'loop' }));
        expect(addClip).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'loop', audioBufferId: 'buf-1', startBeat: 0 })
        );
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('imports an audio file into the selected track when trackId is set', async () => {
        decodeAudioFileMock.mockResolvedValue({
            id: 'buf-2',
            buffer: { duration: 4 },
        });

        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId="t1" beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import Audio…'));
        Object.defineProperty(captured!, 'files', {
            value: [new File([], 'kick.wav')],
            configurable: true,
        });
        await captured!.onchange?.(new Event('change'));

        createSpy.mockRestore();
        // Selected track → no new track, clip goes to t1.
        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1', audioBufferId: 'buf-2' }));
    });

    it('imports a MIDI file via the import handler', async () => {
        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import MIDI…'));
        Object.defineProperty(captured!, 'files', {
            value: [new File([], 'song.mid')],
            configurable: true,
        });
        await captured!.onchange?.(new Event('change'));
        createSpy.mockRestore();

        expect(importMidiFileMock).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('aborts the audio import when the file dialog is cancelled (no file)', async () => {
        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import Audio…'));
        // No files selected (user cancelled the dialog).
        Object.defineProperty(captured!, 'files', { value: [], configurable: true });
        await captured!.onchange?.(new Event('change'));
        createSpy.mockRestore();

        // Nothing is decoded or added when no file was picked.
        expect(decodeAudioFileMock).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
    });

    it('aborts the MIDI import when no file is selected', async () => {
        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId={null} beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import MIDI…'));
        Object.defineProperty(captured!, 'files', { value: [], configurable: true });
        await captured!.onchange?.(new Event('change'));
        createSpy.mockRestore();

        expect(importMidiFileMock).not.toHaveBeenCalled();
    });

    it('notifies on a failed audio decode and adds nothing', async () => {
        decodeAudioFileMock.mockRejectedValue(new Error('corrupt'));
        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId="t1" beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import Audio…'));
        Object.defineProperty(captured!, 'files', { value: [new File([], 'bad.wav')], configurable: true });
        await captured!.onchange?.(new Event('change'));
        createSpy.mockRestore();

        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('Failed to import'), 'error');
        expect(addClip).not.toHaveBeenCalled();
    });

    it('falls back to 120 BPM when the transport tempo is unavailable', async () => {
        const { transportStore } = await import('#/modules/Transport/stores');
        // tempo missing → `?? 120` default drives the clip-duration calc.
        vi.mocked(transportStore as unknown as { value: { tempo?: number } }).value = {};
        decodeAudioFileMock.mockResolvedValue({ id: 'buf-1', buffer: { duration: 2 } });

        let captured: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === 'input') {
                captured = el as HTMLInputElement;
                el.click = vi.fn();
            }
            return el;
        });

        renderWithTooltip(<TimelineEmptyMenu x={0} y={0} trackId="t1" beat={0} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Import Audio…'));
        Object.defineProperty(captured!, 'files', { value: [new File([], 'x.wav')], configurable: true });
        await captured!.onchange?.(new Event('change'));
        createSpy.mockRestore();

        // 2s at 120 BPM → 4 beats; endBeat = 0 + 4 = 4.
        expect(addClip).toHaveBeenCalledWith(expect.objectContaining({ startBeat: 0, endBeat: 4 }));
        // Restore the mock's default tempo for subsequent tests.
        vi.mocked(transportStore as unknown as { value: { tempo?: number } }).value = { tempo: 120 };
    });
});
