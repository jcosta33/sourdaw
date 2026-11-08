import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createTrack } from '#/modules/Arrangement/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { metricGoalStateCodec } from '../metricGoalStateCodec';

import {
    configuredLiteralMetricState,
    configureMetricGoalProject,
    resetMetricGoalProject,
} from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

beforeEach(() => {
    configureMetricGoalProject({
        label: 'numeric object names',
        tracks: [
            createTrack({ id: 'drums', name: 'Drums 100 hz', kind: 'audio' }),
            createTrack({ id: 'bass', name: 'Bass', kind: 'audio' }),
        ],
        sections: [],
    });
});
afterEach(resetMetricGoalProject);

function evaluate(prompt: string, trackId = 'drums') {
    const revision = captureProjectRevision();
    const commandBatch = compilePlannedActionCommandBatch({
        actions: [{ type: 'setTrackGain', payload: { trackId, gain: 1.122, expectedGain: 1 } }],
        actionLabels: ['setTrackGain'],
        autoCommit: false,
        context: getProjectContext(),
        group: { groupId: 'numeric-name', groupLabel: prompt },
        intent: prompt,
        projectRevision: revision,
        runId: 'numeric-name',
    }).commandBatch;
    return evaluateMetricGoalAdmission({
        state: metricGoalStateCodec(configuredLiteralMetricState(commandBatch)),
        commandBatch,
        currentRevision: revision,
    });
}

describe('numeric figures in referenced object names', () => {
    it.each(['Raise "Drums 100 hz" by 1 dB', 'Raise "Drums 100 Hz" by 1 dB'])(
        'accounts for the named object in %s',
        (prompt) => expect(evaluate(prompt).status).toBe('not-required')
    );

    it('does not account for the name of an unreferenced track', () => {
        expect(evaluate('Raise "Drums 100 Hz" by 1 dB', 'bass')).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('100 Hz'),
        });
    });

    it('does not account for a second frequency outside the name', () => {
        expect(evaluate('Raise "Drums 100 Hz" by 1 dB and keep centroid above 100 Hz')).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('100 Hz'),
        });
    });
});
