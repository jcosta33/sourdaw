import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getProjectContext } from '../getProjectContext';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as any,
    midiStoreValue: { value: null } as any,
    transportStoreValue: { value: null } as any,
    workspaceStoreValue: { value: null } as any,
    clipSelectionStoreValue: { value: null } as any,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
    clipSelectionStore: {
        get value() {
            return mocks.clipSelectionStoreValue.value;
        },
    },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
    },
}));

describe('getProjectContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.transportStoreValue.value = null;
        mocks.workspaceStoreValue.value = null;
        mocks.clipSelectionStoreValue.value = null;
    });

    it('returns context with default values when stores are empty', () => {
        const context = getProjectContext();

        expect(context.tempo).toBe(120);
        expect(context.timeSignature).toEqual([4, 4]);
        expect(context.tracks).toEqual([]);
        expect(context.selectedTrackId).toBeNull();
        expect(context.selectedClipId).toBeNull();
        expect(context.selectedClipIds).toEqual([]);
        expect(context.activeView).toBe('arrange');
        expect(context.playheadPosition).toBe(0);
    });

    it('maps track, clip, and device properties correctly', () => {
        mocks.trackStoreValue.value = {
            selectedTrackId: 't1',
            tracks: [
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    armed: false,
                    gain: 0.8,
                    pan: -10,
                    clips: [{ id: 'c1', name: 'Vox 1', type: 'audio', startBeat: 0, endBeat: 4 }],
                    devices: [{ id: 'd1', type: 'EQ', bypassed: false }],
                },
                {
                    id: 't2',
                    name: 'Synth',
                    kind: 'midi',
                    muted: true,
                    soloed: false,
                    armed: true,
                    gain: 1.0,
                    pan: 0,
                    clips: [{ id: 'c2', name: 'Chords', type: 'midi', startBeat: 4, endBeat: 8 }],
                    devices: [],
                },
            ],
        };

        mocks.midiStoreValue.value = {
            notesByClipId: {
                c2: [{}, {}, {}], // 3 notes
            },
        };

        mocks.transportStoreValue.value = {
            tempo: 130,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 4,
            playheadPosition: 16,
        };

        mocks.clipSelectionStoreValue.value = {
            selectedClipId: 'c2',
            selectedClipIds: ['c2'],
        };
        mocks.workspaceStoreValue.value = { mode: 'mix' };

        const context = getProjectContext();

        expect(context.tempo).toBe(130);
        expect(context.timeSignature).toEqual([3, 4]);
        expect(context.selectedTrackId).toBe('t1');
        expect(context.selectedClipId).toBe('c2');
        expect(context.selectedClipIds).toEqual(['c2']);
        expect(context.activeView).toBe('mix');
        expect(context.playheadPosition).toBe(16);

        expect(context.tracks).toHaveLength(2);

        // First track (audio)
        expect(context.tracks[0]).toMatchObject({
            id: 't1',
            name: 'Vocals',
            kind: 'audio',
            muted: false,
            soloed: true,
            armed: false,
            gain: 0.8,
            pan: -10,
            clipCount: 1,
            deviceCount: 1,
        });
        expect(context.tracks[0]?.clips[0]).toEqual({
            id: 'c1',
            name: 'Vox 1',
            type: 'audio',
            startBeat: 0,
            endBeat: 4,
            noteCount: 0,
        });
        expect(context.tracks[0]?.devices[0]).toEqual({
            id: 'd1',
            type: 'EQ',
            bypassed: false,
        });

        // Second track (midi)
        expect(context.tracks[1]?.clips[0]).toMatchObject({
            id: 'c2',
            type: 'midi',
            noteCount: 3,
        });
    });
});
