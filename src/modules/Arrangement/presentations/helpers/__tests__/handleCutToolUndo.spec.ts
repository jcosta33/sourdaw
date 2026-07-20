import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { hitTestClip } from '../../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { handleCutTool } from '../timelineTools';

// Pixel hit-testing is a rendering concern; everything downstream of the cut —
// splitClip, the undo composition, and the Command undo/redo stack — runs for
// real so the undo contract is pinned end to end.
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: vi.fn() }));

type ClipRect = { id: string; startBeat: number; endBeat: number };

function clipRects(): ClipRect[] {
    const state = trackStore.value;
    if (!state) {
        throw new Error('expected track state');
    }
    return state.tracks
        .flatMap((track) => track.clips)
        .map((clip) => ({ id: clip.id, startBeat: clip.startBeat, endBeat: clip.endBeat }))
        .sort((alpha, beta) => alpha.startBeat - beta.startBeat);
}

describe('handleCutTool undo/redo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        const clip = ClipDummy.create({
            id: 'c1',
            trackId: 't1',
            name: 'Groove',
            startBeat: 0,
            endBeat: 8,
            gain: 0.6,
            fadeOutBeats: 0.5,
            color: '#123456',
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 't1', clips: [clip] })],
            selectedTrackId: null,
        });
        vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1' });
    });

    it('splits the hit clip into two halves', () => {
        handleCutTool(10, 10, 4);

        const rects = clipRects();
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ id: 'c1', startBeat: 0, endBeat: 4 });
        expect(rects[1]).toMatchObject({ startBeat: 4, endBeat: 8 });
    });

    it('undo restores exactly one intact clip with its original id and properties', async () => {
        handleCutTool(10, 10, 4);
        await undo();

        const state = trackStore.value;
        const clips = state?.tracks[0]?.clips ?? [];
        expect(clips).toHaveLength(1);
        expect(clips[0]).toMatchObject({
            id: 'c1',
            name: 'Groove',
            startBeat: 0,
            endBeat: 8,
            gain: 0.6,
            fadeOutBeats: 0.5,
            color: '#123456',
        });
    });

    it('redo after undo re-applies the split instead of no-oping', async () => {
        handleCutTool(10, 10, 4);
        await undo();
        await redo();

        const rects = clipRects();
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ id: 'c1', startBeat: 0, endBeat: 4 });
        expect(rects[1]).toMatchObject({ startBeat: 4, endBeat: 8 });
    });
});
