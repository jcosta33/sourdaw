import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { classifyMidiReplayProducer } from '../../midiNoteTransforms/classifyMidiReplayProducer';
import { projectMidiClipDataThroughRestores } from '../projectMidiClipDataThroughRestores';
import { projectMidiSnapshotThroughAction } from '../projectMidiSnapshotThroughAction';
import { readRestoredMidiOwnerIds } from '../readRestoredMidiOwnerIds';

// An action none of the MIDI lookups lists: each one must give it its stated default.
const unlisted: AppAction = { type: 'togglePlayback' };
const snapshot = {
    notes: { present: true, value: [{ id: 'n' }] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

describe('MIDI batch projection lookups for an unlisted action', () => {
    it('classifies it as producing neither a clip nor a track', () => {
        expect(classifyMidiReplayProducer(unlisted)).toEqual({ kind: 'none' });
    });

    it('classifies a clip and a track producer', () => {
        const clip: AppAction = {
            type: 'addClip',
            payload: { id: 'c', trackId: 't', name: 'Clip', type: 'midi', startBeat: 0, endBeat: 1 },
        };
        const track: AppAction = { type: 'addTrack', payload: { id: 't', kind: 'midi' } };

        expect(classifyMidiReplayProducer(clip)).toEqual({ kind: 'clip', action: clip });
        expect(classifyMidiReplayProducer(track)).toEqual({ kind: 'track', action: track });
    });

    it('leaves the clip snapshot as it was', () => {
        expect(projectMidiSnapshotThroughAction(unlisted, 'clip', snapshot)).toBe(snapshot);
    });

    it('restores no owner ids', () => {
        expect(readRestoredMidiOwnerIds(unlisted)).toEqual([]);
    });

    it('restores no controller buckets', () => {
        const before = projectMidiClipDataThroughRestores([]);

        expect(projectMidiClipDataThroughRestores([unlisted])).toEqual(before);
    });
});
