import { describe, expect, it } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { getClipLifecycleKind } from '../llmClipLifecycleKind';

function parseAction(json: string): RuntimeAction {
    const action: RuntimeAction = JSON.parse(json);
    return action;
}

describe('getClipLifecycleKind', () => {
    it('reads the kind of each listed action', () => {
        expect(getClipLifecycleKind(parseAction('{"type":"removeClip","payload":{"clipId":"c1"}}'))).toBe('remove');
        expect(getClipLifecycleKind(parseAction('{"type":"glueClips","payload":{"clipIds":["c1"]}}'))).toBe('glue');
        expect(getClipLifecycleKind(parseAction('{"type":"lockClip","payload":{"clipId":"c1"}}'))).toBe('lock');
    });

    it('answers none for an action type the record lists as leaving clips in place', () => {
        expect(getClipLifecycleKind({ type: 'toggleSidebar' })).toBe('none');
    });

    it('answers none for an inherited object member parsed from JSON', () => {
        expect(getClipLifecycleKind(parseAction('{"type":"constructor","payload":{}}'))).toBe('none');
    });
});
