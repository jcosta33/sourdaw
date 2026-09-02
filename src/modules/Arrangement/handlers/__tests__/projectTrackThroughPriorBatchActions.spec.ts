import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type Clip, type Track, createTrack } from '../../models/Track';
import { projectTrackThroughPriorBatchActions } from '../projectTrackThroughPriorBatchActions';

function clip(id: string, trackId: string): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: 'oklch(0.5 0.1 200)',
        locked: false,
        muted: false,
    };
}

function trackWithClips(id: string, clipIds: readonly string[]): Track {
    return { ...createTrack({ id, kind: 'midi', name: id }), clips: clipIds.map((clipId) => clip(clipId, id)) };
}

function discardClip(clipId: string): AppAction {
    return {
        type: 'discardDuplicatedClip',
        payload: { clipId, generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '{}' } },
    };
}

const laterAction: AppAction = {
    type: 'addClip',
    payload: { trackId: 'track-1', name: 'Later', startBeat: 8, endBeat: 12 },
};

function projectFor(track: Track, actions: readonly AppAction[]): Track {
    return projectTrackThroughPriorBatchActions(track, {
        actions: [...actions, laterAction],
        actionIndex: actions.length,
    });
}

describe('projectTrackThroughPriorBatchActions', () => {
    it('removes a clip an earlier discardDuplicatedClip compensated and keeps the rest', () => {
        // A later action in the same batch must plan against the clips that will actually exist by
        // the time it runs, so a compensated creation has to disappear from the projection.
        const projected = projectFor(trackWithClips('track-1', ['clip-a', 'clip-b']), [discardClip('clip-a')]);

        expect(projected.clips.map((candidate) => candidate.id)).toEqual(['clip-b']);
    });

    it('removes every clip discarded earlier in the batch', () => {
        const projected = projectFor(trackWithClips('track-1', ['clip-a', 'clip-b', 'clip-c']), [
            discardClip('clip-a'),
            discardClip('clip-c'),
        ]);

        expect(projected.clips.map((candidate) => candidate.id)).toEqual(['clip-b']);
    });

    it('leaves a track that never held the discarded clip untouched', () => {
        const other = trackWithClips('track-2', ['clip-x', 'clip-y']);

        const projected = projectFor(other, [discardClip('clip-a')]);

        expect(projected.clips).toEqual(other.clips);
    });

    it('reads the discard as pending only while it precedes the action being planned', () => {
        const track = trackWithClips('track-1', ['clip-a', 'clip-b']);
        const discard = discardClip('clip-a');

        const beforeTheDiscard = projectTrackThroughPriorBatchActions(track, {
            actions: [laterAction, discard],
            actionIndex: 0,
        });

        expect(beforeTheDiscard.clips.map((candidate) => candidate.id)).toEqual(['clip-a', 'clip-b']);
    });

    it('projects onto a copy rather than the live track it was handed', () => {
        const track = trackWithClips('track-1', ['clip-a', 'clip-b']);

        projectFor(track, [discardClip('clip-a')]);

        expect(track.clips.map((candidate) => candidate.id)).toEqual(['clip-a', 'clip-b']);
    });

    it('projects an earlier automation-mode write for later expected-state validation', () => {
        const track = trackWithClips('track-1', []);

        const projected = projectFor(track, [
            { type: 'setAutomationMode', payload: { trackId: track.id, mode: 'write' } },
        ]);

        expect(projected.automationMode).toBe('write');
        expect(track.automationMode).toBe('read');
    });
});
