import { type ReactNode } from 'react';

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
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
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
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
import { useTrackMuteToggle } from '../../hooks/useTrackMuteToggle';
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
    if (!root) {
        throw new Error('Expected seeded project');
    }
    return root;
}
function Header() {
    const { tracks } = useTracks();
    const track = tracks.find((item) => item.id === 'target');
    if (!track) {
        throw new Error('Expected target track');
    }
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
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
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
        render(<Header />);
        expect(screen.getByRole('button', { name: 'Mute Target' })).toBeInTheDocument();
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
    it('routes two rapid button clicks through ordered actions', async () => {
        const clicks = 2;
        const muted = false;
        render(<Header />);
        expect(screen.getByRole('button', { name: 'Mute Target' })).toBeInTheDocument();
        const history = captureUndoHistory();
        const sharedHistory = structuredClone(rawRoot().actionHistory);
        const other = structuredClone(rawRoot().tracks.tracks[1]);
        const button = screen.getByRole('button', { name: 'Mute Target' });
        for (let index = 0; index < clicks; index += 1) {
            fireEvent.click(button);
        }
        await waitFor(() => {
            expect(rawRoot().tracks.tracks[0]?.muted).toBe(muted);
            expect(trackStore.value?.tracks[0]?.muted).toBe(muted);
            expect(engine.mute.mock.calls.findLast(([id]) => id === 'target')).toEqual(['target', muted]);
            expect(notices).toEqual([]);
        });
        expect(rawRoot().tracks.tracks[1]).toEqual(other);
        expect(captureUndoHistory()).toEqual(history);
        expect(rawRoot().actionHistory).toEqual(sharedHistory);
    });
    it.each([
        { clicks: 2, muted: false },
        { clicks: 3, muted: true },
    ])('settles all $clicks queued hook requests in the same project', async ({ clicks, muted }) => {
        const hook = renderHook(() => useTrackMuteToggle('target', false));
        const history = captureUndoHistory();
        const sharedHistory = structuredClone(rawRoot().actionHistory);
        const requests = Array.from({ length: clicks }, () => hook.result.current());
        await Promise.all(requests);
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(muted);
        expect(trackStore.value?.tracks[0]?.muted).toBe(muted);
        expect(engine.mute.mock.calls.findLast(([id]) => id === 'target')).toEqual(['target', muted]);
        expect(captureUndoHistory()).toEqual(history);
        expect(rawRoot().actionHistory).toEqual(sharedHistory);
        expect(notices).toEqual([]);
        hook.unmount();
    });
    it('retires a held request when its target changes', async () => {
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await held.promise;
        });
        await entered.promise;
        const hook = renderHook(({ id }) => useTrackMuteToggle(id, false), { initialProps: { id: 'target' } });
        const root = structuredClone(rawRoot());
        const history = captureUndoHistory();
        const pending = hook.result.current();
        hook.rerender({ id: 'other' });
        held.resolve();
        await snapshot;
        await pending;
        expect(rawRoot()).toEqual(root);
        expect(captureUndoHistory()).toEqual(history);
        expect(engine.mute).not.toHaveBeenCalled();
        expect(engine.gain).not.toHaveBeenCalled();
        expect(engine.soloGate).not.toHaveBeenCalled();
        hook.unmount();
    });
    it('does not overwrite a peer mute change while a second toggle is queued', async () => {
        let peer: Promise<void> | undefined;
        engine.mute.mockImplementationOnce(() => {
            peer = executeAppAction({
                type: 'muteTrack',
                payload: { trackId: 'target', muted: false, expectedMuted: true },
            });
        });
        const hook = renderHook(() => useTrackMuteToggle('target', false));
        const first = hook.result.current();
        const second = hook.result.current();
        await first;
        if (!peer) {
            throw new Error('Expected peer action to enter during the first toggle');
        }
        await peer;
        await second;
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(false);
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(captureUndoHistory().past).toHaveLength(1);
        hook.unmount();
    });
    it('refuses publication when the header unmounts after staging the handler', async () => {
        const staged = Promise.withResolvers<void>();
        engine.mute.mockImplementationOnce(() => {
            staged.resolve();
        });
        const hook = renderHook(() => useTrackMuteToggle('target', false));
        const root = structuredClone(rawRoot());
        const revision = captureProjectRevision();
        const history = captureUndoHistory();
        const pending = hook.result.current();
        await staged.promise;
        hook.unmount();
        await pending;
        expect(rawRoot()).toEqual(root);
        expect(captureProjectRevision()).toBe(revision);
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(captureUndoHistory()).toEqual(history);
    });
    it('retires a held action on unmount after the real snapshot boundary settles', async () => {
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await held.promise;
        });
        await entered.promise;
        const hook = renderHook(() => useTrackMuteToggle('target', false));
        const root = structuredClone(rawRoot());
        const history = captureUndoHistory();
        const revision = captureProjectRevision();
        const pending = hook.result.current();
        hook.unmount();
        held.resolve();
        await snapshot;
        await pending;
        expect(rawRoot()).toEqual(root);
        expect(captureProjectRevision()).toBe(revision);
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(captureUndoHistory()).toEqual(history);
        expect(engine.mute).not.toHaveBeenCalled();
        expect(engine.gain).not.toHaveBeenCalled();
        expect(engine.soloGate).not.toHaveBeenCalled();
    });
    it('retires held requests when a writable successor retains the same track IDs', async () => {
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await held.promise;
        });
        await entered.promise;
        const hook = renderHook(() => useTrackMuteToggle('target', false));
        const identity = captureProjectIdentity();
        const first = hook.result.current();
        const second = hook.result.current();
        removeCrdtDoc('root');
        createCrdtDoc('root');
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'target', name: 'Successor', kind: 'midi', muted: false }),
                TrackDummy.create({ id: 'other', name: 'Successor other', kind: 'midi', muted: true }),
            ],
            selectedTrackId: 'target',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        expect(captureProjectIdentity()).not.toBe(identity);
        expect(agentProjectRepairStateStore.value).toBeNull();
        expect(rawRoot().tracks.tracks).toEqual(trackStore.value?.tracks);
        expect(trackStore.value?.tracks[0]).toMatchObject({ id: 'target', name: 'Successor', muted: false });
        const replacement = structuredClone(rawRoot());
        const revision = captureProjectRevision();
        const tracks = structuredClone(trackStore.value);
        const history = captureUndoHistory();
        held.resolve();
        await snapshot;
        await Promise.all([first, second]);
        expect(rawRoot()).toEqual(replacement);
        expect(captureProjectRevision()).toBe(revision);
        expect(trackStore.value).toEqual(tracks);
        expect(captureUndoHistory()).toEqual(history);
        expect(engine.mute).not.toHaveBeenCalled();
        expect(engine.gain).not.toHaveBeenCalled();
        expect(engine.soloGate).not.toHaveBeenCalled();
        await hook.result.current();
        expect(rawRoot().tracks.tracks[0]?.muted).toBe(true);
        expect(trackStore.value?.tracks[0]?.muted).toBe(true);
        hook.unmount();
    });
    it.each(['hook', 'owner'] as const)(
        'admits a fresh successor gesture through %s while old requests are held',
        async (route) => {
            const entered = Promise.withResolvers<void>();
            const held = Promise.withResolvers<void>();
            const snapshot = transactSnapshot(async () => {
                entered.resolve();
                await held.promise;
            });
            await entered.promise;
            const hook = renderHook(() => useTrackMuteToggle('target', false));
            const oldIdentity = captureProjectIdentity();
            const first = hook.result.current();
            const second = hook.result.current();
            removeCrdtDoc('root');
            createCrdtDoc('root');
            trackStore.set({
                tracks: [
                    TrackDummy.create({ id: 'target', name: 'Successor', kind: 'midi', muted: false }),
                    TrackDummy.create({ id: 'other', name: 'Successor other', kind: 'midi', muted: true }),
                ],
                selectedTrackId: 'target',
                ghostClips: [],
            });
            flushAutomergeStorageWrites();
            const identity = captureProjectIdentity();
            expect(identity).not.toBe(oldIdentity);
            expect(agentProjectRepairStateStore.value).toBeNull();
            expect(rawRoot().tracks.tracks).toEqual(trackStore.value?.tracks);
            expect(trackStore.value?.tracks[0]).toMatchObject({ id: 'target', name: 'Successor', muted: false });
            const other = structuredClone(rawRoot().tracks.tracks[1]);
            const history = captureUndoHistory();
            const sharedHistory = structuredClone(rawRoot().actionHistory);
            const sameProject = () => captureProjectIdentity() === identity;
            let fresh: Promise<void>;
            if (route === 'hook') {
                fresh = hook.result.current();
            } else {
                fresh = executeUserAppAction(
                    { type: 'muteTrack', payload: { trackId: 'target', muted: true, expectedMuted: false } },
                    { skipUndo: true, shouldExecute: sameProject, shouldCommit: sameProject }
                );
            }
            held.resolve();
            await snapshot;
            await Promise.all([first, second, fresh]);
            expect(rawRoot().tracks.tracks[0]).toMatchObject({ id: 'target', name: 'Successor', muted: true });
            expect(trackStore.value?.tracks[0]).toMatchObject({ id: 'target', name: 'Successor', muted: true });
            expect(rawRoot().tracks.tracks[1]).toEqual(other);
            expect(trackStore.value?.tracks[1]).toEqual(other);
            expect(captureUndoHistory()).toEqual(history);
            expect(rawRoot().actionHistory).toEqual(sharedHistory);
            expect(notices).toEqual([]);
            hook.unmount();
        }
    );
    it('refuses a real click when project repair is required without changing project or engine', async () => {
        render(<Header />);
        expect(screen.getByRole('button', { name: 'Mute Target' })).toBeInTheDocument();
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
