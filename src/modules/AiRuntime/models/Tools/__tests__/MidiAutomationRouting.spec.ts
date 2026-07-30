import { describe, expect, it } from 'vitest';

import { automationTools } from '../MidiAutomationRouting';

function getAutomationTool(name: string) {
    return automationTools.find((candidate) => candidate.function.name === name);
}

describe('automation tool schemas', () => {
    it('keeps automation-lane creation limited to app-owned gain and pan metadata', () => {
        expect(getAutomationTool('addAutomationLane')?.function.parameters).toEqual({
            type: 'object',
            properties: {
                trackId: { type: 'string' },
                parameterId: {
                    type: 'string',
                    enum: ['gain', 'pan'],
                    description: 'Track parameter to automate',
                },
            },
            required: ['trackId', 'parameterId'],
        });
    });

    it('publishes bounded point and lane-enabled tool arguments', () => {
        expect(getAutomationTool('addAutomationPoint')?.function.parameters).toEqual({
            type: 'object',
            properties: {
                laneId: { type: 'string' },
                beat: { type: 'number' },
                value: { type: 'number', description: 'Within the selected lane minValue and maxValue bounds' },
                curve: {
                    type: 'string',
                    enum: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'],
                    description: 'Interpolation between this point and the next',
                },
            },
            required: ['laneId', 'beat', 'value'],
        });
        expect(getAutomationTool('setAutomationLaneEnabled')?.function.parameters).toEqual({
            type: 'object',
            properties: {
                laneId: { type: 'string' },
                enabled: { type: 'boolean', description: 'true=enable, false=disable' },
            },
            required: ['laneId', 'enabled'],
        });
    });
});
