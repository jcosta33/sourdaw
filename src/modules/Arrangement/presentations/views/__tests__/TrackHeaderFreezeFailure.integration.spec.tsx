import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { createEventBus } from '#/infra/events/createEventBus';
import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { captureFreezeStateSnapshot } from '../../../useCases/freezeBounce/freezeStateSnapshot';
import { activeFreezeTasks } from '../../../useCases/freezeBounce/freezeTrack';
import { type renderTrackOffline } from '../../../useCases/freezeBounce/renderOffline';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { useTracks } from '../../hooks/useTracks';
import { TrackHeader } from '../TrackHeader';

const offlineRender = vi.hoisted(() => vi.fn<typeof renderTrackOffline>());
vi.mock('../../../useCases/freezeBounce/renderOffline', () => ({ renderTrackOffline: offlineRender }));
vi.unmock('#/components/ui/tooltip');

// Keep the real header, tooltip and subscription; omit unrelated editors/meters.
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

function buffer(value: number): AudioBuffer {
    const samples = new Float32Array(128).fill(value);
    return {
        duration: samples.length / 48000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48000,
        getChannelData: () => samples,
        copyFromChannel: (destination) => destination.set(samples.subarray(0, destination.length)),
        copyToChannel: (source) => samples.set(source.subarray(0, samples.length)),
    };
}

function rawRoot() {
    const root = getCrdtDoc<{
        tracks: { tracks: Track[] };
        takeLanes: unknown;
        actionHistory: { entries: unknown[] };
    }>('root');
    if (!root) {
        throw new Error('Expected the seeded project document');
    }
    return root;
}

function requiredTrack(tracks: Track[]): Track {
    const track = tracks.find((candidate) => candidate.id === 'freeze-track');
    if (!track) {
        throw new Error('Expected the seeded Freeze track');
    }
    return track;
}

function projectedTrack(): Track {
    return requiredTrack(trackStore.value?.tracks ?? []);
}

function material(track: Track) {
    return {
        kind: track.kind,
        clips: track.clips,
        devices: track.devices,
        alternatives: track.alternatives,
        activeAlternativeId: track.activeAlternativeId,
    };
}

function SubscribedTrackHeader() {
    const { tracks, selectedTrackId } = useTracks();
    const track = requiredTrack(tracks);
    return (
        <TooltipProvider delayDuration={0}>
            <TrackHeader track={track} isSelected={track.id === selectedTrackId} />
        </TooltipProvider>
    );
}

async function freeze(): Promise<void> {
    await act(async () => {
        await executeAppAction({ type: 'freezeTrack', payload: { trackId: 'freeze-track' } });
    });
}

describe('registered failed Freeze projected into the subscribed track header', () => {
    let notices: NotifyPayload[];
    let priorTrack: Track;
    const priorTakeLanes = {
        lanes: [
            {
                id: 'prior-take-lane',
                trackId: 'freeze-track',
                takes: [
                    {
                        id: 'prior-take',
                        clipId: 'editable-clip',
                        name: 'Original take',
                        startBeat: 2,
                        endBeat: 6,
                        selected: true,
                    },
                ],
                activeCompRegions: [],
            },
        ],
    };

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
        resetCrdtProjectAuthority('Connected Freeze header acceptance');
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
        activeFreezeTasks.clear();
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        offlineRender.mockReset();
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        cleanup();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        activeFreezeTasks.clear();
        vi.restoreAllMocks();
    });

    function mount(kind: 'audio' | 'folder') {
        const clip = ClipDummy.create({ id: 'editable-clip', trackId: 'freeze-track', startBeat: 2, endBeat: 6 });
        priorTrack = TrackDummy.create({
            id: 'freeze-track',
            name: 'Retained Freeze material',
            kind,
            clips: [clip],
            devices: [
                {
                    id: 'prior-device',
                    name: 'Prior device',
                    type: 'gain',
                    bypassed: false,
                    parameterValues: { gain: 0.8 },
                },
            ],
            activeAlternativeId: 'prior-alternative',
            alternatives: [{ id: 'prior-alternative', name: 'Prior alternative', clips: [clip] }],
            frozen: true,
            frozenBufferId: 'prior-frozen-buffer',
            freezeState: {
                status: 'stale',
                freezeId: 'prior-freeze',
                frozenBufferId: 'prior-frozen-buffer',
                sourceContentHash: 'prior-hash',
                renderedAt: 50,
                compensationSeconds: 0.02,
            },
        });
        trackStore.set({ tracks: [priorTrack], selectedTrackId: priorTrack.id, ghostClips: [] });
        takeLaneStore.set(priorTakeLanes);
        flushAutomergeStorageWrites();
        render(<SubscribedTrackHeader />);
        expect(screen.getByRole('row')).toBeInTheDocument();
        expect(screen.queryByTestId('track-freeze-error-badge')).not.toBeInTheDocument();
    }

    function expectRetainedFailure(message: string) {
        const expected = {
            ...captureFreezeStateSnapshot(priorTrack),
            freezeState: { ...priorTrack.freezeState, status: 'error', errorMessage: message },
        };
        for (const track of [requiredTrack(rawRoot().tracks.tracks), projectedTrack()]) {
            expect(captureFreezeStateSnapshot(track)).toEqual(expected);
            expect(material(track)).toEqual(material(priorTrack));
        }
        expect(rawRoot().takeLanes).toEqual(priorTakeLanes);
        expect(takeLaneStore.value).toEqual(priorTakeLanes);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(rawRoot().actionHistory.entries).toHaveLength(0);
        expect(actionHistoryStore.value?.entries).toHaveLength(0);
        expect(macroStore.value?.currentRecording).toHaveLength(0);
        expect(activeFreezeTasks.size).toBe(0);
    }

    async function expectVisibleReason(message: string, interaction: 'focus' | 'pointer') {
        const badge = await screen.findByRole('button', { name: `Freeze error: ${message}` });
        expect(badge).toHaveTextContent('ERROR');
        if (interaction === 'focus') {
            fireEvent.focus(badge);
        } else {
            fireEvent.pointerMove(badge, { pointerType: 'mouse' });
        }
        expect(await screen.findByRole('tooltip')).toHaveTextContent(message);
    }

    for (const kind of ['audio', 'folder'] as const) {
        it.each(['renderer-rejection', 'silent-bake'] as const)(
            `retains a %s reason through the registered action and subscribed ${kind} header`,
            async (failure) => {
                mount(kind);
                if (failure === 'renderer-rejection') {
                    offlineRender.mockRejectedValue(new Error('Offline renderer refused the retained track'));
                } else {
                    offlineRender.mockImplementation(async (_track, _start, _end, options) => {
                        options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
                        return buffer(0);
                    });
                }

                await freeze();

                expect(offlineRender).toHaveBeenCalledTimes(1);
                expect(notices).toHaveLength(1);
                const message = notices[0]?.message;
                expect(message).toContain(
                    failure === 'renderer-rejection' ? 'Offline renderer refused' : 'rendered as digital silence'
                );
                if (!message) {
                    throw new Error('Expected the actual failed Freeze notice');
                }
                expect(notices).toEqual([{ message, level: 'error' }]);
                expectRetainedFailure(message);
                await expectVisibleReason(message, failure === 'renderer-rejection' ? 'focus' : 'pointer');
            }
        );
    }

    it('updates the mounted header through successful retry, Undo and Redo of the exact take', async () => {
        mount('audio');
        const message = 'First render refused';
        offlineRender.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(buffer(0.5));
        await freeze();
        expectRetainedFailure(message);
        await expectVisibleReason(message, 'focus');
        const failed = captureFreezeStateSnapshot(requiredTrack(rawRoot().tracks.tracks));

        await freeze();

        const succeeded = captureFreezeStateSnapshot(requiredTrack(rawRoot().tracks.tracks));
        expect(succeeded.freezeState.status).toBe('frozen');
        expect(succeeded.freezeState.frozenBufferId).toBeTruthy();
        expect(succeeded.freezeState.frozenBufferId).not.toBe('prior-frozen-buffer');
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(succeeded);
        expect(screen.queryByTestId('track-freeze-error-badge')).not.toBeInTheDocument();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);

        await act(async () => {
            await undo();
        });
        expect(captureFreezeStateSnapshot(requiredTrack(rawRoot().tracks.tracks))).toEqual(failed);
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(failed);
        await expectVisibleReason(message, 'focus');

        await act(async () => {
            await redo();
        });
        expect(captureFreezeStateSnapshot(requiredTrack(rawRoot().tracks.tracks))).toEqual(succeeded);
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(succeeded);
        expect(material(projectedTrack())).toEqual(material(priorTrack));
        expect(rawRoot().takeLanes).toEqual(priorTakeLanes);
        expect(screen.queryByTestId('track-freeze-error-badge')).not.toBeInTheDocument();
        expect(offlineRender).toHaveBeenCalledTimes(2);
    });
});
