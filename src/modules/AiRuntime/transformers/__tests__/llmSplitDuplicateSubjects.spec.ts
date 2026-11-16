import { describe, expect, it } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
import {
    getSplitDuplicateSubjects,
    noSplitDuplicateSubjects,
    splitDuplicateSubjectsByActionType,
} from '../llmSplitDuplicateSubjects';

const none = {
    addedClipTrackId: null,
    duplicatedClipId: null,
    duplicatedTrackId: null,
    gluedClipId: null,
    splitClipId: null,
};

function parseAction(json: string): RuntimeAction {
    const action: RuntimeAction = JSON.parse(json);
    return action;
}

describe('getSplitDuplicateSubjects', () => {
    it.each([
        ['{"type":"addClip","payload":{"trackId":"t1"}}', { addedClipTrackId: 't1' }],
        ['{"type":"duplicateClip","payload":{"clipId":"c1"}}', { duplicatedClipId: 'c1' }],
        ['{"type":"duplicateClipToNextBar","payload":{"clipId":"c2"}}', { duplicatedClipId: 'c2' }],
        ['{"type":"duplicateTrack","payload":{"trackId":"t2"}}', { duplicatedTrackId: 't2' }],
        ['{"type":"glueClips","payload":{"clipIds":["c3","c4"]}}', { gluedClipId: 'c3' }],
        ['{"type":"splitClip","payload":{"clipId":"c5"}}', { splitClipId: 'c5' }],
    ])('reads the subject of %s', (json, expected) => {
        expect(getSplitDuplicateSubjects(parseAction(json))).toEqual({ ...none, ...expected });
    });

    it('answers no subject for an unlisted action type', () => {
        expect(getSplitDuplicateSubjects({ type: 'toggleSidebar' })).toEqual(none);
    });

    it('answers no subject for an inherited object member parsed from JSON', () => {
        expect(getSplitDuplicateSubjects(parseAction('{"type":"constructor","payload":{}}'))).toEqual(none);
    });

    it('lists exactly the action types whose entry reads a payload', () => {
        const listed = Object.entries(splitDuplicateSubjectsByActionType).filter(
            ([, reader]) => reader !== noSplitDuplicateSubjects
        );
        const types = listed.map(([type]) => type).sort();

        expect(types).toEqual([
            'addClip',
            'duplicateClip',
            'duplicateClipToNextBar',
            'duplicateTrack',
            'glueClips',
            'splitClip',
        ]);
    });
});
