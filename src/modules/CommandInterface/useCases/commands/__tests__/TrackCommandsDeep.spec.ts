import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackCommands } from '../TrackCommands';

const executeUserAppAction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const { mockDuplicateTrack, mockRemoveTrack } = vi.hoisted(() => ({
    mockDuplicateTrack: vi.fn(),
    mockRemoveTrack: vi.fn(),
}));
const { mockTrackStore, mockGetSelectedTrackId } = vi.hoisted(() => ({
    mockTrackStore: {
        value: {
            tracks: [
                {
                    id: 't1',
                    name: 'Track 1',
                    groupId: 'grp-1',
                    frozen: true,
                    freezeState: { status: 'frozen', frozenBufferId: 'buffer-1', freezeId: 'take-1', renderedAt: 123 },
                },
            ],
        },
    },
    mockGetSelectedTrackId: vi.fn<() => string | null>(() => 't1'),
}));
const { mockConfirmUser, mockNotifyUser } = vi.hoisted(() => ({
    mockConfirmUser: vi.fn<() => Promise<boolean>>(),
    mockNotifyUser: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    duplicateTrack: mockDuplicateTrack,
    removeTrack: mockRemoveTrack,
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mockTrackStore,
    resolveEligibleClipWriteTarget: vi.fn(() => ({ status: 'eligible', trackId: 't1' })),
}));
vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: vi.fn(() => ({ isCurrent: () => true })),
}));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: mockConfirmUser }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: vi.fn() }));
vi.mock('../../selectionHelpers/getSelectedTrackId', () => ({
    getSelectedTrackId: () => mockGetSelectedTrackId(),
}));

function runAction(id: string): void {
    const cmd = trackCommands.find((c) => c.id === id);
    if (!cmd) {
        throw new Error(`Command ${id} not found`);
    }
    if (typeof cmd.action !== 'function') {
        throw new TypeError(`Command ${id} action is not callable`);
    }
    cmd.action();
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('trackCommands — guarded action commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSelectedTrackId.mockReturnValue('t1');
        mockConfirmUser.mockReset().mockResolvedValue(false);
        executeUserAppAction.mockReset().mockResolvedValue(undefined);
    });

    it('duplicate-track calls duplicateTrack with the selected trackId', () => {
        runAction('duplicate-track');
        expect(mockDuplicateTrack).toHaveBeenCalledWith('t1');
    });

    it('duplicate-track does nothing when no track is selected', () => {
        mockGetSelectedTrackId.mockReturnValue(null);
        runAction('duplicate-track');
        expect(mockDuplicateTrack).not.toHaveBeenCalled();
    });

    it('delete-track dispatches the registered removeTrack action with the selected trackId', () => {
        runAction('delete-track');
        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'removeTrack', payload: { trackId: 't1' } });
        expect(mockRemoveTrack).not.toHaveBeenCalled();
    });

    it('freeze-track dispatches freezeTrack action', async () => {
        runAction('freeze-track');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'freezeTrack',
            payload: { trackId: 't1' },
        });
    });

    it('unfreeze-track dispatches unfreezeTrack action', async () => {
        runAction('unfreeze-track');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'unfreezeTrack',
            payload: { trackId: 't1' },
        });
    });

    it('flatten-track waits for the named destructive confirmation and dispatches nothing on cancellation', async () => {
        const decision = Promise.withResolvers<boolean>();
        mockConfirmUser.mockReturnValue(decision.promise);
        runAction('flatten-track');

        expect(mockConfirmUser).toHaveBeenCalledExactlyOnceWith({
            title: 'Flatten "Track 1"?',
            message:
                'Flatten replaces the editable clips and devices with one rendered audio clip. Undo before leaving this project if you want the originals back.',
            confirmLabel: 'Flatten',
            cancelLabel: 'Cancel',
            variant: 'danger',
        });
        expect(executeUserAppAction).not.toHaveBeenCalled();
        decision.resolve(false);
        await decision.promise;
        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });

    it('flatten-track dispatches the captured original target only after acceptance', async () => {
        const decision = Promise.withResolvers<boolean>();
        mockConfirmUser.mockReturnValue(decision.promise);
        runAction('flatten-track');
        mockGetSelectedTrackId.mockReturnValue('t2');
        decision.resolve(true);
        await vi.waitFor(() => expect(executeUserAppAction).toHaveBeenCalledTimes(1));
        expect(executeUserAppAction).toHaveBeenCalledWith(
            { type: 'flattenTrack', payload: { trackId: 't1' } },
            { shouldExecute: expect.any(Function) }
        );
    });

    it('flatten-track contains dispatcher rejection and reports the failure visibly', async () => {
        mockConfirmUser.mockResolvedValue(true);
        executeUserAppAction.mockRejectedValue(new Error('Flatten commit refused'));
        runAction('flatten-track');
        await vi.waitFor(() =>
            expect(mockNotifyUser).toHaveBeenCalledExactlyOnceWith(
                'Flatten could not finish. Check the track before trying again.',
                'error'
            )
        );
    });

    it('flatten-track is still listed with the same metadata and does nothing without selection', () => {
        const command = trackCommands.find((candidate) => candidate.id === 'flatten-track');
        expect(command).toMatchObject({
            label: 'Flatten Track',
            description: 'Commit a frozen track to audio',
            category: 'Track',
        });
        expect(command?.isAvailable).toBeUndefined();
        expect(command?.shortcut).toBeUndefined();
        mockGetSelectedTrackId.mockReturnValue(null);
        runAction('flatten-track');
        expect(mockConfirmUser).not.toHaveBeenCalled();
        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('bounce-to-new-track dispatches bounceToNewTrack action', async () => {
        runAction('bounce-to-new-track');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });
    });

    it('bounce-in-place dispatches bounceInPlace action', async () => {
        runAction('bounce-in-place');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'bounceInPlace',
            payload: { trackId: 't1' },
        });
    });

    it('arm-track dispatches armTrack with armed: true', async () => {
        runAction('arm-track');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });
    });

    it('solo-track dispatches soloTrack with soloed: true', async () => {
        runAction('solo-track');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });
    });

    it('mute-track dispatches muteTrack with muted: true', async () => {
        runAction('mute-track');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
    });

    it('group-tracks dispatches groupTracks wrapping the selected trackId', async () => {
        runAction('group-tracks');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'groupTracks',
            payload: { trackIds: ['t1'], name: 'Group' },
        });
    });

    it('ungroup-tracks dispatches ungroupTracks with the track groupId from the store', async () => {
        runAction('ungroup-tracks');
        await flush();
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'ungroupTracks',
            payload: { groupId: 'grp-1' },
        });
    });

    it('ungroup-tracks does nothing when the track has no groupId', async () => {
        const track = mockTrackStore.value.tracks[0] as Record<string, unknown>;
        const original = track.groupId;
        track.groupId = undefined;
        runAction('ungroup-tracks');
        await flush();
        expect(executeUserAppAction).not.toHaveBeenCalled();
        // Restore for other tests
        track.groupId = original;
    });

    it('guarded commands do nothing when no track is selected', async () => {
        mockGetSelectedTrackId.mockReturnValue(null);
        runAction('freeze-track');
        runAction('arm-track');
        runAction('group-tracks');
        runAction('ungroup-tracks');
        await flush();
        expect(executeUserAppAction).not.toHaveBeenCalled();
    });
});

describe('trackCommands — declarative actions', () => {
    it('add-audio-track is a static action object with kind audio', () => {
        const cmd = trackCommands.find((c) => c.id === 'add-audio-track')!;
        expect(cmd.action).toEqual({ type: 'addTrack', payload: { name: 'Audio', kind: 'audio' } });
    });

    it('add-midi-track is a static action object with kind midi', () => {
        const cmd = trackCommands.find((c) => c.id === 'add-midi-track')!;
        expect(cmd.action).toEqual({ type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } });
    });

    it('add-folder is a static action object', () => {
        const cmd = trackCommands.find((c) => c.id === 'add-folder')!;
        expect(cmd.action).toEqual({ type: 'createFolder', payload: { name: 'Folder' } });
    });

    it('clear-solos is a static action object', () => {
        const cmd = trackCommands.find((c) => c.id === 'clear-solos')!;
        expect(cmd.action).toEqual({ type: 'clearSolos' });
    });

    it('consolidate-all-tracks is a static action object', () => {
        const cmd = trackCommands.find((c) => c.id === 'consolidate-all-tracks')!;
        expect(cmd.action).toEqual({ type: 'consolidateAllTracks' });
    });
});
