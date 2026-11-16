import { describe, expect, it } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
import {
    automationPointLaneIdByActionType,
    getAutomationPointLaneId,
    noAutomationPointLane,
} from '../llmAutomationPointLaneId';

function parseAction(json: string): RuntimeAction {
    const action: RuntimeAction = JSON.parse(json);
    return action;
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

    it('lists exactly the action types whose entry reads a payload', () => {
        const listed = Object.entries(automationPointLaneIdByActionType).filter(
            ([, reader]) => reader !== noAutomationPointLane
        );
        const types = listed.map(([type]) => type).sort();

        expect(types).toEqual(['addAutomationPoint']);
    });
});
