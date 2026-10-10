import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { getCommandDivergenceTargetIds } from '../getCommandDivergenceTargetIds';

const addAutomationLane = (parameterId: string): AppAction => ({
    type: 'addAutomationLane',
    payload: { parameterId, parameterName: 'Parameter', trackId: 'trk' },
});

const automateParameterRange = (parameterId: string): AppAction => ({
    type: 'automateParameterRange',
    payload: { parameterId, range: { endBeat: 8, startBeat: 0 }, trackId: 'trk', value: 0.5 },
});

describe('getCommandDivergenceTargetIds device-qualified parameters', () => {
    it.each([
        ['addAutomationLane', addAutomationLane('dev1:drive')],
        ['automateParameterRange', automateParameterRange('dev1:drive')],
    ])('names the owning device of a %s parameter alongside its track', (_name, action) => {
        expect(getCommandDivergenceTargetIds({ actions: [action], targetIds: [] }).toSorted()).toEqual(['dev1', 'trk']);
    });

    it('splits a device-qualified key on its first colon only', () => {
        expect(
            getCommandDivergenceTargetIds({ actions: [addAutomationLane('dev1:band:gain')], targetIds: [] }).toSorted()
        ).toEqual(['dev1', 'trk']);
    });

    it.each([
        ['addAutomationLane', addAutomationLane('gain')],
        ['automateParameterRange', automateParameterRange('pan')],
    ])('invents no device target for the track-level parameter of a %s', (_name, action) => {
        expect(getCommandDivergenceTargetIds({ actions: [action], targetIds: [] })).toEqual(['trk']);
    });

    it('invents no device target for a send level, whose owner is a bus', () => {
        expect(
            getCommandDivergenceTargetIds({ actions: [automateParameterRange('send:bus1')], targetIds: [] })
        ).toEqual(['trk']);
    });

    it('still reports no parameter key as an object reference', () => {
        expect(
            compileCommandArgumentMetadata({
                parameterId: 'dev1:drive',
                parameterName: 'Parameter',
                trackId: 'trk',
            }).objectReferences.map((reference) => reference.id)
        ).toEqual(['trk']);
    });
});
