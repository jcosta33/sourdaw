import { describe, expect, it } from 'vitest';

import { automationTools, routingTools } from '../MidiAutomationRouting';

function getAutomationTool(name: string) {
    return automationTools.find((candidate) => candidate.function.name === name);
}

function getRoutingTool(name: string) {
    return routingTools.find((candidate) => candidate.function.name === name);
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
        // Bounds belong to the lane the point lands in, not to the schema: the
        // window a gain lane honours is its own minValue/maxValue, so a keyword
        // bound here would be a second, blind ceiling.
        const pointProperties = JSON.stringify(getAutomationTool('addAutomationPoint')?.function.parameters.properties);
        expect(pointProperties, 'addAutomationPoint states a keyword bound').not.toMatch(/"(minimum|maximum)":/);
        expect(getAutomationTool('addAutomationPoint')?.function.parameters).toEqual({
            type: 'object',
            properties: {
                laneId: { type: 'string' },
                beat: { type: 'number' },
                valueDb: {
                    type: 'number',
                    description:
                        "Absolute level, gain lanes only. Within the lane's own minValueDb and maxValueDb; -60 dB (floor) to 6 dB (ceiling); 0 dB is unity",
                },
                deltaDb: {
                    type: 'number',
                    description:
                        "Change relative to the level the gain lane already draws at this beat, in decibels (negative is quieter). Gain lanes only; the result must land within the lane's own minValueDb and maxValueDb",
                },
                value: {
                    type: 'number',
                    description:
                        "Deprecated linear amplitude on a gain lane; prefer valueDb (absolute dB) or deltaDb (relative dB). On every other lane this is the value in the lane's own units, within its minValue and maxValue bounds",
                },
                curve: {
                    type: 'string',
                    enum: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'],
                    description: 'Interpolation between this point and the next',
                },
            },
            // A level is stated in one of three mutually exclusive fields, so no
            // single one of them can be required: the payload validator decides
            // which combination lands, and a required key here would refuse the
            // decibel forms before the model could reach them.
            required: ['laneId', 'beat'],
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

    it('publishes the complete bounded automation transform surface', () => {
        expect(
            automationTools
                .filter((candidate) =>
                    [
                        'setAutomationMode',
                        'scaleAutomation',
                        'stretchAutomation',
                        'invertAutomation',
                        'reverseAutomation',
                        'thinAutomation',
                        'quantizeAutomation',
                    ].includes(candidate.function.name)
                )
                .map((candidate) => ({
                    name: candidate.function.name,
                    required: candidate.function.parameters.required,
                }))
        ).toEqual([
            { name: 'setAutomationMode', required: ['trackId', 'mode'] },
            { name: 'scaleAutomation', required: ['laneId', 'factor'] },
            { name: 'stretchAutomation', required: ['laneId', 'factor'] },
            { name: 'invertAutomation', required: ['laneId'] },
            { name: 'reverseAutomation', required: ['laneId'] },
            { name: 'thinAutomation', required: ['laneId'] },
            { name: 'quantizeAutomation', required: ['laneId', 'gridSize'] },
        ]);
    });

    it('limits sidechain tools to provider-owned endpoint IDs', () => {
        for (const name of ['addSidechainRoute', 'removeSidechainRoute']) {
            const parameters = getRoutingTool(name)?.function.parameters;

            expect(parameters?.type).toBe('object');
            expect(Object.keys(parameters?.properties ?? {})).toEqual(['sourceTrackId', 'targetTrackId']);
            if (name === 'addSidechainRoute') {
                expect(parameters?.properties.sourceTrackId).toEqual({
                    type: 'string',
                    description: 'The trigger track (e.g. kick)',
                });
                expect(parameters?.properties.targetTrackId).toEqual({
                    type: 'string',
                    description: 'The track being ducked (e.g. bass)',
                });
            } else {
                expect(parameters?.properties.sourceTrackId).toEqual({ type: 'string' });
                expect(parameters?.properties.targetTrackId).toEqual({ type: 'string' });
            }
            expect(parameters?.required).toEqual(['sourceTrackId', 'targetTrackId']);
        }
    });
});
