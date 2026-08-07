import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackCommands } from '../TrackCommands';

const executeAppAction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const { mockDuplicateTrack, mockRemoveTrack } = vi.hoisted(() => ({
    mockDuplicateTrack: vi.fn(),
    mockRemoveTrack: vi.fn(),
}));
const { mockTrackStore, mockGetSelectedTrackId } = vi.hoisted(() => ({
    mockTrackStore: {
        value: {
            tracks: [{ id: 't1', name: 'Track 1', groupId: 'grp-1' }],
        },
    },
    mockGetSelectedTrackId: vi.fn<() => string | null>(() => 't1'),
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    duplicateTrack: mockDuplicateTrack,
    removeTrack: mockRemoveTrack,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mockTrackStore }));
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

    it('delete-track calls removeTrack with the selected trackId', () => {
        runAction('delete-track');
        expect(mockRemoveTrack).toHaveBeenCalledWith('t1');
    });

    it('freeze-track dispatches freezeTrack action', async () => {
        runAction('freeze-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'freezeTrack',
            payload: { trackId: 't1' },
        });
    });

    it('unfreeze-track dispatches unfreezeTrack action', async () => {
        runAction('unfreeze-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'unfreezeTrack',
            payload: { trackId: 't1' },
        });
    });

    it('flatten-track dispatches flattenTrack action', async () => {
        runAction('flatten-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'flattenTrack',
            payload: { trackId: 't1' },
        });
    });

    it('bounce-to-new-track dispatches bounceToNewTrack action', async () => {
        runAction('bounce-to-new-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });
    });

    it('bounce-in-place dispatches bounceInPlace action', async () => {
        runAction('bounce-in-place');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'bounceInPlace',
            payload: { trackId: 't1' },
        });
    });

    it('arm-track dispatches armTrack with armed: true', async () => {
        runAction('arm-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });
    });

    it('solo-track dispatches soloTrack with soloed: true', async () => {
        runAction('solo-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });
    });

    it('mute-track dispatches muteTrack with muted: true', async () => {
        runAction('mute-track');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
    });

    it('group-tracks dispatches groupTracks wrapping the selected trackId', async () => {
        runAction('group-tracks');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'groupTracks',
            payload: { trackIds: ['t1'], name: 'Group' },
        });
    });

    it('ungroup-tracks dispatches ungroupTracks with the track groupId from the store', async () => {
        runAction('ungroup-tracks');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
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
        expect(executeAppAction).not.toHaveBeenCalled();
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
        expect(executeAppAction).not.toHaveBeenCalled();
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
