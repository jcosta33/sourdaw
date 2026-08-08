import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { TrackContextMenu } from '../TrackContextMenu';
import { TrackListView } from '../TrackListView';

/**
 * Deleting a track from the UI must be undoable.
 *
 * The app has two delete gestures for a track — the context menu's "Delete
 * Track" and the Delete/Backspace key on the track list — and an undoable
 * `removeTrack` *action* whose handler snapshots the clips, devices, routing,
 * automation lanes, MIDI and takes so `restoreTrack` can replay them. Both
 * gestures called the bare `removeTrack` use case instead, which captures
 * nothing, so a track (and everything on it) left the project unrecoverably
 * while the identical AI-driven delete stayed undoable.
 *
 * The observable is the project itself: delete, press undo, and the track is
 * back with its clip still on it. Everything under the click is real — the
 * Arrangement handler map, `executeAppAction`, a real Automerge document, the
 * real undo stack. Only the audio-engine seam, the confirm dialog and the
 * routing/event fan-out are stubbed, none of which this assertion reads.
 */

vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));
vi.mock('#/utils/UI/useContextMenuDismiss', () => ({ useContextMenuDismiss: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    removeTrackStrip: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
}));
vi.mock('#/modules/Routing/useCases', () => ({
    getAllSidechainRoutes: vi.fn(() => []),
    wireSidechainRoutes: vi.fn(),
    // Returns the finalizer the restore handler pushes straight into its
    // post-commit effect list, so it has to be callable.
    restoreSidechainRoutes: vi.fn(() => () => undefined),
}));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: vi.fn(),
}));

/**
 * The remove/restore handlers publish `track.removed` / `track.added` through
 * the DI event bus, which only `bootstrap.ts` wires. A recording stub keeps the
 * post-commit effect list runnable without pulling the composition root in.
 */
class RecordingArrangementEventBus extends ArrangementEventBus {
    readonly emitted: string[] = [];
    emit(event: string): Promise<void> {
        this.emitted.push(event);
        return Promise.resolve();
    }
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'track-to-delete';
const OTHER_TRACK_ID = 'track-that-stays';
const CLIP_ID = 'clip-on-the-deleted-track';

function seedProject(): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: TRACK_ID,
                name: 'Lead Vocal',
                kind: 'audio',
                clips: [
                    {
                        id: CLIP_ID,
                        trackId: TRACK_ID,
                        name: 'Take 3',
                        startBeat: 12,
                        endBeat: 20,
                        type: 'audio',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#ff0000',
                        locked: false,
                        muted: false,
                    },
                ],
            }),
            TrackDummy.create({ id: OTHER_TRACK_ID, name: 'Drums', kind: 'audio' }),
        ],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
}

function trackIds(): string[] {
    return (trackStore.value?.tracks ?? []).map((track) => track.id);
}

function deletedTrackClipSpan(): Array<{ id: string; startBeat: number; endBeat: number }> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    return (track?.clips ?? []).map((clip) => ({ id: clip.id, startBeat: clip.startBeat, endBeat: clip.endBeat }));
}

describe('deleting a track from the UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('track delete undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setArrangementEventBus(new RecordingArrangementEventBus());
        vi.mocked(confirmUser).mockResolvedValue(true);
        seedProject();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('puts the track and its clip back when the context-menu delete is undone', async () => {
        const track = trackStore.value!.tracks[0]!;
        render(
            <TooltipProvider>
                <TrackContextMenu track={track}>
                    <div data-testid="track-row">Lead Vocal</div>
                </TrackContextMenu>
            </TooltipProvider>
        );

        fireEvent.contextMenu(screen.getByTestId('track-row'));
        fireEvent.click(screen.getByText('Delete Track'));

        await vi.waitFor(() => {
            expect(trackIds()).toEqual([OTHER_TRACK_ID]);
        });

        await undo();

        // Position in the track list and the clip's span are both asserted: a
        // restore that appended a bare track would satisfy "the id is back".
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
        expect(deletedTrackClipSpan()).toEqual([{ id: CLIP_ID, startBeat: 12, endBeat: 20 }]);
    });

    it('puts the track and its clip back when the Delete-key delete is undone', async () => {
        render(
            <TooltipProvider>
                <TrackListView />
            </TooltipProvider>
        );

        const selectedRow = screen.getAllByRole('row')[0]!;
        fireEvent.keyDown(selectedRow, { key: 'Delete' });

        await vi.waitFor(() => {
            expect(trackIds()).toEqual([OTHER_TRACK_ID]);
        });

        await undo();

        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
        expect(deletedTrackClipSpan()).toEqual([{ id: CLIP_ID, startBeat: 12, endBeat: 20 }]);
    });

    it('deletes nothing and records no history when the confirm is cancelled', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        const track = trackStore.value!.tracks[0]!;
        render(
            <TooltipProvider>
                <TrackContextMenu track={track}>
                    <div data-testid="track-row">Lead Vocal</div>
                </TrackContextMenu>
            </TooltipProvider>
        );

        fireEvent.contextMenu(screen.getByTestId('track-row'));
        fireEvent.click(screen.getByText('Delete Track'));

        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalled();
        });

        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);

        // Pins the negative: routing the delete through the undoable action
        // must not make a *cancelled* delete undoable-into-existence either.
        await undo();
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
    });
});
