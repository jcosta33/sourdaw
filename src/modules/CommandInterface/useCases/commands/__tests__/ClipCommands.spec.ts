import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CallableCommandEntry } from '../../searchCommandRegistry';
import { clipCommands } from '../ClipCommands';

const executeAppAction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    duplicateTrack: vi.fn(),
    removeTrack: vi.fn(),
    renameClip: vi.fn(),
    splitClip: vi.fn(),
}));

const { mockTrackStore } = vi.hoisted(() => ({
    mockTrackStore: {
        value: {
            tracks: [
                {
                    id: 't1',
                    name: 'Track 1',
                    clips: [{ id: 'c1', name: 'Clip 1', startBeat: 0, endBeat: 4, loopEnabled: false }],
                },
            ],
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mockTrackStore,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { isPlaying: false } },
    playheadPositionRef: { current: 2.5 },
}));

vi.mock('../../selectionHelpers/getSelectedClipId', () => ({
    getSelectedClipId: vi.fn(() => 'c1'),
}));
vi.mock('../../selectionHelpers/getSelectedClipIds', () => ({
    getSelectedClipIds: vi.fn(() => ['c1', 'c2']),
}));
vi.mock('../../selectionHelpers/getSelectedTrackId', () => ({
    getSelectedTrackId: vi.fn(() => 't1'),
}));

function findCommand(id: string): CallableCommandEntry {
    const cmd = clipCommands.find((c) => c.id === id);
    if (!cmd) {
        throw new Error(`Command ${id} not found`);
    }
    return cmd;
}

function runAction(id: string): void {
    const cmd = findCommand(id);
    if (typeof cmd.action !== 'function') {
        throw new Error(`Command ${id} action is not callable`);
    }
    cmd.action();
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('clipCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('split-clip calls splitClip with the playhead position', async () => {
        const { splitClip } = await import('#/modules/Arrangement/useCases');
        runAction('split-clip');
        expect(splitClip).toHaveBeenCalledWith('c1', 2.5);
    });

    it('normalize-clip dispatches normalizeClip action with the selected clipId', async () => {
        runAction('normalize-clip');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'normalizeClip',
            payload: { clipId: 'c1' },
        });
    });

    it('reverse-clip dispatches reverseClip action with the selected clipId', async () => {
        runAction('reverse-clip');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'reverseClip',
            payload: { clipId: 'c1' },
        });
    });

    it('glue-clips dispatches glueClips when 2+ clips are selected', async () => {
        runAction('glue-clips');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'glueClips',
            payload: { clipIds: ['c1', 'c2'] },
        });
    });

    it('glue-clips does nothing when fewer than 2 clips are selected', async () => {
        const { getSelectedClipIds } = await import('../../selectionHelpers/getSelectedClipIds');
        vi.mocked(getSelectedClipIds).mockReturnValueOnce(['c1']);
        runAction('glue-clips');
        await flush();
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('consolidate-selection dispatches with trackId and clip bounds from the store', async () => {
        runAction('consolidate-selection');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'consolidateSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });
    });

    it('set-clip-loop dispatches with the inverted loopEnabled state', async () => {
        runAction('set-clip-loop');
        await flush();
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'setClipLoop',
            payload: { clipId: 'c1', enabled: true },
        });
    });
});
