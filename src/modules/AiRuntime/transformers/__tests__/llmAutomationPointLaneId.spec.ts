import { describe, expect, it } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { getAutomationPointLaneId } from '../llmAutomationPointLaneId';

function parseAction(json: string): RuntimeAction {
    return JSON.parse(json) as RuntimeAction;
}

describe('getAutomationPointLaneId', () => {
    it('reads the lane of a point write', () => {
        const action = parseAction('{"type":"addAutomationPoint","payload":{"laneId":"lane-1"}}');
        expect(getAutomationPointLaneId(action)).toBe('lane-1');
    });

    it('answers null for a whole-lane transform, which has its own lookup', () => {
        const action = parseAction('{"type":"thinAutomation","payload":{"laneId":"lane-1"}}');
        expect(getAutomationPointLaneId(action)).toBeNull();
    });

    it('answers null for an inherited object member parsed from JSON', () => {
        expect(getAutomationPointLaneId(parseAction('{"type":"constructor","payload":{}}'))).toBeNull();
    });
});
