import { describe, expect, it } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { getClipDestinationTrackIds } from '../llmClipDestinationTrackIds';

function parseAction(json: string): RuntimeAction {
    return JSON.parse(json) as RuntimeAction;
}

describe('getClipDestinationTrackIds', () => {
    it.each([
        ['{"type":"moveClip","payload":{"clipId":"c","trackId":"t1"}}', ['t1']],
        ['{"type":"addClip","payload":{"trackId":"t2"}}', ['t2']],
        ['{"type":"drawClip","payload":{"trackId":"t3"}}', ['t3']],
        ['{"type":"duplicateClipAt","payload":{"clipId":"c","destinationTrackId":"t4"}}', ['t4']],
        [
            '{"type":"moveClips","payload":{"moves":[{"clipId":"a","trackId":"t5"},{"clipId":"b","trackId":"t6"}]}}',
            ['t5', 't6'],
        ],
    ])('reads the destination tracks of %s', (json, expected) => {
        expect(getClipDestinationTrackIds(parseAction(json))).toEqual(expected);
    });

    it('answers no tracks for an unlisted action type', () => {
        expect(getClipDestinationTrackIds({ type: 'toggleSidebar' })).toEqual([]);
    });

    it('answers no tracks for an inherited object member parsed from JSON', () => {
        expect(getClipDestinationTrackIds(parseAction('{"type":"constructor","payload":{}}'))).toEqual([]);
    });
});
