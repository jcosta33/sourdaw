import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { useTracks } from '../../hooks/useTracks';
import { TrackListView } from '../TrackListView';

// The real track header and the real header context menu render inside the real list; the dispatch is
// answered by removing or hiding the track from the list the view reads.
vi.unmock('#/components/ui/tooltip');

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(function useStoreMock<Value>(_store: unknown, defaultValue: Value): Value {
        return defaultValue;
    }),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [], selectedTrackId: null })),
}));

vi.mock('../../hooks/useTrackMuteToggle', () => ({
    useTrackMuteToggle: () => vi.fn(() => Promise.resolve()),
}));

vi.mock('../MiniMasterSpectrum', () => ({
    MiniMasterSpectrum: () => null,
}));

vi.mock('../TrackHeader/InlineTrackName', () => ({
    InlineTrackName: ({ track }: { track: Track }) => <span>{track.name}</span>,
}));
vi.mock('../TrackHeader/ResizeHandle', () => ({ ResizeHandle: () => null }));
vi.mock('../TrackHeader/InputSelector', () => ({ InputSelector: () => null }));
vi.mock('../TrackHeader/TrackLevelIndicator', () => ({ TrackLevelIndicator: () => null }));
vi.mock('../TrackHeader/LevainLoadingSpinner', () => ({ LevainLoadingSpinner: () => null }));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: vi.fn() }));
vi.mock('../../../useCases/getTrackTemplates', () => ({ getTrackTemplates: vi.fn(() => []) }));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        getSnapshot: () => ({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true, viewportHeight: 0 }),
        subscribeReact: () => () => {},
    },
    setScrollY: vi.fn(),
    setTimelineViewportHeight: vi.fn(),
}));

vi.mock('#/modules/Preferences/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Preferences/useCases')>()),
    defaultPreferences: { trackHeight: 'normal' },
    onSoloModePreferenceApplied: vi.fn(),
    setTrackHeight: vi.fn(),
    updatePreferences: vi.fn(),
}));
vi.mock('#/modules/AiRuntime/useCases', () => ({ injectPromptDraft: vi.fn() }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));

const makeTrack = (id: string, overrides: Partial<Track> = {}): Track =>
    TrackDummy.create({ id, name: `Track ${id}`, kind: 'audio', height: 64, ...overrides });

let currentTracks: Track[] = [];

const renderList = (tracks: Track[]): { rerender: () => void } => {
    currentTracks = tracks;
    vi.mocked(useTracks).mockImplementation(() => ({ tracks: currentTracks, selectedTrackId: null }));
    const view = render(
        <TooltipProvider>
            <TrackListView />
        </TooltipProvider>
    );
    return {
        rerender: () =>
            view.rerender(
                <TooltipProvider>
                    <TrackListView />
                </TooltipProvider>
            ),
    };
};

const getRow = (trackId: string): HTMLElement => {
    const row = document.querySelector<HTMLElement>(`[data-track-id="${trackId}"]`);
    if (!row) {
        throw new Error(`no row for ${trackId}`);
    }
    return row;
};

const chooseFromMenu = (trackId: string, item: string): void => {
    const row = getRow(trackId);
    row.focus();
    fireEvent.contextMenu(within(row).getByText(`Track ${trackId}`));
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

describe('TrackListView focus after a header menu removes its row', () => {
    let finishRemoval: (rerender: () => void, drop: (tracks: Track[]) => Track[]) => void;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(confirmUser).mockResolvedValue(true);
        finishRemoval = (rerender, drop) => {
            currentTracks = drop(currentTracks);
            act(rerender);
        };
    });

    const threeTracks = (): Track[] => [makeTrack('a'), makeTrack('b'), makeTrack('c')];

    it('focuses the next row after Delete Track removes the focused row', async () => {
        const { rerender } = renderList(threeTracks());
        chooseFromMenu('b', 'Delete Track');
        await waitFor(() => {
            expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'removeTrack', payload: { trackId: 'b' } });
        });
        finishRemoval(rerender, (tracks) => tracks.filter((track) => track.id !== 'b'));
        expect(document.activeElement).toBe(getRow('c'));
    });

    it('focuses the previous row after Delete Track removes the last row of several', async () => {
        const { rerender } = renderList(threeTracks());
        chooseFromMenu('c', 'Delete Track');
        await waitFor(() => {
            expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        });
        finishRemoval(rerender, (tracks) => tracks.filter((track) => track.id !== 'c'));
        expect(document.activeElement).toBe(getRow('b'));
    });

    it('focuses the next row after Hide Track hides the focused row', () => {
        const { rerender } = renderList(threeTracks());
        chooseFromMenu('b', 'Hide Track');
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'hideTrack',
            payload: { trackId: 'b', hidden: true },
        });
        finishRemoval(rerender, (tracks) =>
            tracks.map((track) => (track.id === 'b' ? { ...track, hidden: true } : track))
        );
        expect(document.activeElement).toBe(getRow('c'));
    });

    it('focuses the track list when the last remaining row is deleted', async () => {
        const { rerender } = renderList([makeTrack('only')]);
        chooseFromMenu('only', 'Delete Track');
        await waitFor(() => {
            expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        });
        finishRemoval(rerender, () => []);
        expect(document.activeElement).toBe(screen.getByRole('grid', { name: 'Track list' }));
    });

    it('focuses the next row when the row disappears while its own menu still holds focus', () => {
        const { rerender } = renderList(threeTracks());
        const row = getRow('b');
        row.focus();
        fireEvent.contextMenu(within(row).getByText('Track b'));
        expect(screen.getByRole('menu')).toContainElement(document.activeElement as HTMLElement);
        finishRemoval(rerender, (tracks) =>
            tracks.map((track) => (track.id === 'b' ? { ...track, hidden: true } : track))
        );
        expect(document.activeElement).toBe(getRow('c'));
    });

    it('leaves focus alone when a row is removed while focus rests outside the list', async () => {
        const { rerender } = renderList(threeTracks());
        getRow('b').focus();
        const outside = document.body.appendChild(document.createElement('button'));
        outside.focus();
        finishRemoval(rerender, (tracks) => tracks.filter((track) => track.id !== 'b'));
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });
});
