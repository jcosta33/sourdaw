import { type ReactNode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectRevision,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import {
    setNotificationEventBus,
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { useTracks } from '../../hooks/useTracks';
import { TrackHeader } from '../TrackHeader';

const engine = vi.hoisted(() => ({ mute: vi.fn(), gain: vi.fn(), soloGate: vi.fn() }));
// Keep the action, handler, storage, projection, and notification bus real; cut audio hardware and unrelated header editors.
vi.mock('#/modules/AudioEngine/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackMute: engine.mute,
    setTrackGain: engine.gain,
    setTrackSoloGate: engine.soloGate,
}));
vi.unmock('#/components/ui/tooltip');
vi.mock('../TrackContextMenu', () => ({
    TrackContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../TrackHeader/InlineTrackName', () => ({
    InlineTrackName: ({ track }: { track: Track }) => <span>{track.name}</span>,
}));
vi.mock('../TrackHeader/ResizeHandle', () => ({ ResizeHandle: () => null }));
vi.mock('../TrackHeader/InputSelector', () => ({ InputSelector: () => null }));
vi.mock('../TrackHeader/TrackLevelIndicator', () => ({ TrackLevelIndicator: () => null }));
vi.mock('../TrackHeader/LevainLoadingSpinner', () => ({ LevainLoadingSpinner: () => null }));

function rawRoot() {
    const root = getCrdtDoc<{ tracks: { tracks: Track[] }; actionHistory: { entries: unknown[] } }>('root');
    if (!root) throw new Error('Expected seeded project');
    return root;
}
function Header() {
    const { tracks } = useTracks();
    const track = tracks.find((item) => item.id === 'target');
    if (!track) throw new Error('Expected target track');
    return (
        <TooltipProvider delayDuration={0}>
            <TrackHeader track={track} isSelected={false} />
        </TooltipProvider>
    );
}

describe('track header mute admission', () => {
    let notices: NotifyPayload[];
    beforeEach(() => {
        notices = [];
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => notices.push(notice));
        setNotificationEventBus(bus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Header mute admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'target', name: 'Target', kind: 'midi', muted: false }),
                TrackDummy.create({ id: 'other', name: 'Other', kind: 'midi', muted: true }),
            ],
            selectedTrackId: 'target',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        engine.mute.mockClear();
        engine.gain.mockClear();
        engine.soloGate.mockClear();
        render(<Header />);
    });
    afterEach(() => {
        cleanup();
        agentProjectRepairStateStore.set(null);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
    });
    it('admits both button targets without changing either history', async () => {
        await act(async () => {
            await executeAppAction({
                type: 'muteTrack',
                payload: { trackId: 'other', muted: false, expectedMuted: true },
            });
        });
        const history = captureUndoHistory();
        const sharedHistory = structuredClone(rawRoot().actionHistory);
        const other = structuredClone(rawRoot().tracks.tracks[1]);
        fireEvent.click(screen.getByRole('button', { name: 'Mute Target' }));
        await screen.findByRole('button', { name: 'Unmute Target' });
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(true);
        expect(trackStore.value?.tracks[0]?.muted).toBe(true);
        expect(engine.mute).toHaveBeenCalledWith('target', true);
        expect(rawRoot().tracks.tracks[1]).toEqual(other);
        expect(captureUndoHistory()).toEqual(history);
        expect(rawRoot().actionHistory).toEqual(sharedHistory);

        fireEvent.click(screen.getByRole('button', { name: 'Unmute Target' }));
        await screen.findByRole('button', { name: 'Mute Target' });
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(false);
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(engine.mute).toHaveBeenCalledWith('target', false);
        expect(rawRoot().tracks.tracks[1]).toEqual(other);
        expect(captureUndoHistory()).toEqual(history);
        expect(rawRoot().actionHistory).toEqual(sharedHistory);
    });
    it('keeps an ordinary mute action undoable and redoable', async () => {
        await act(async () => {
            await executeAppAction({
                type: 'muteTrack',
                payload: { trackId: 'target', muted: true, expectedMuted: false },
            });
        });
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(true);
        expect(trackStore.value?.tracks[0]?.muted).toBe(true);
        await act(async () => {
            await undo();
        });
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(false);
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        await act(async () => {
            await redo();
        });
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(true);
        expect(trackStore.value?.tracks[0]?.muted).toBe(true);
    });
    it('refuses a real click when project repair is required without changing project or engine', async () => {
        await act(async () => {
            await executeAppAction({
                type: 'muteTrack',
                payload: { trackId: 'other', muted: false, expectedMuted: true },
            });
        });
        engine.mute.mockClear();
        engine.gain.mockClear();
        engine.soloGate.mockClear();
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: captureProjectRevision(),
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        const root = structuredClone(rawRoot());
        const revision = captureProjectRevision();
        const tracks = structuredClone(trackStore.value);
        const history = captureUndoHistory();
        fireEvent.click(screen.getByRole('button', { name: 'Mute Target' }));
        await waitFor(() =>
            expect(notices).toEqual([
                { message: 'Project repair is required before project actions can execute', level: 'warning' },
            ])
        );
        expect(rawRoot()).toEqual(root);
        expect(captureProjectRevision()).toBe(revision);
        expect(trackStore.value).toEqual(tracks);
        expect(captureUndoHistory()).toEqual(history);
        expect(engine.mute).not.toHaveBeenCalled();
        expect(engine.gain).not.toHaveBeenCalled();
        expect(engine.soloGate).not.toHaveBeenCalled();
    });
});
