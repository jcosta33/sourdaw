import { beforeEach, describe, expect, it } from 'vitest';

import { undoHistoryStore, type UndoHistoryStoreState } from '#/modules/Command/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { decodeTrackSnapshot } from '../../../stores/trackStore';
import {
    forgetDiscardedPluginStates,
    overlayDiscardedPluginStates,
    recordDiscardedPluginStates,
} from '../discardedPluginStateCarry';

type HistoryEntry = UndoHistoryStoreState['past'][number];

function historyEntry(id: string): HistoryEntry {
    return {
        kind: 'action',
        id,
        label: 'Duplicate track',
        timestamp: 0,
        source: 'manual',
        action: { type: 'duplicateTrack', payload: { trackId: 'track-1' } },
        inverseAction: null,
    };
}

function hostedTrack(id: string, stateChunk: string) {
    return TrackDummy.create({
        id,
        name: 'Copy',
        kind: 'audio',
        devices: [
            {
                id: `${id}-device`,
                name: 'Reverb',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-abc',
                externalInstanceId: `${id}-instance`,
                externalStateChunk: stateChunk,
            },
        ],
    });
}

/** The chunk a redo of `undoEntryId` would restore for a snapshot taken with the creation-time chunk. */
function redoneChunk(undoEntryId: string, trackId: string): string | undefined {
    const restores = [{ trackSnapshot: hostedTrack(trackId, 'c2F2ZWQ=') }];
    overlayDiscardedPluginStates(undoEntryId, restores);
    return decodeTrackSnapshot(restores[0]!.trackSnapshot)?.devices[0]?.externalStateChunk;
}

describe('discardedPluginStateCarry', () => {
    beforeEach(() => {
        forgetDiscardedPluginStates('entry-a');
        forgetDiscardedPluginStates('entry-b');
        undoHistoryStore.set({ past: [], future: [] });
    });

    it('overlays the recorded chunk on every materialization until the redo commits', () => {
        undoHistoryStore.set({ past: [historyEntry('entry-a')], future: [] });
        recordDiscardedPluginStates('entry-a', [hostedTrack('copy-a', 'ZWRpdGVk')]);

        expect(redoneChunk('entry-a', 'copy-a')).toBe('ZWRpdGVk');
        expect(redoneChunk('entry-a', 'copy-a')).toBe('ZWRpdGVk');

        forgetDiscardedPluginStates('entry-a');
        expect(redoneChunk('entry-a', 'copy-a')).toBe('c2F2ZWQ=');
    });

    it('prunes a record once its entry leaves history, keeping records of entries still held', () => {
        undoHistoryStore.set({ past: [historyEntry('entry-a'), historyEntry('entry-b')], future: [] });
        recordDiscardedPluginStates('entry-a', [hostedTrack('copy-a', 'ZWRpdGVk')]);

        undoHistoryStore.set({ past: [historyEntry('entry-b')], future: [] });
        recordDiscardedPluginStates('entry-b', [hostedTrack('copy-b', 'Zmlyc3Q=')]);

        expect(redoneChunk('entry-a', 'copy-a')).toBe('c2F2ZWQ=');
        expect(redoneChunk('entry-b', 'copy-b')).toBe('Zmlyc3Q=');
    });

    it('keeps a record whose entry waits on the redo stack', () => {
        undoHistoryStore.set({ past: [historyEntry('entry-b')], future: [historyEntry('entry-a')] });
        recordDiscardedPluginStates('entry-a', [hostedTrack('copy-a', 'ZWRpdGVk')]);
        recordDiscardedPluginStates('entry-b', [hostedTrack('copy-b', 'Zmlyc3Q=')]);

        expect(redoneChunk('entry-a', 'copy-a')).toBe('ZWRpdGVk');
    });
});
