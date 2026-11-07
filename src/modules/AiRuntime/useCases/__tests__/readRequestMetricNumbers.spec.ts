import { describe, expect, it } from 'vitest';

import { type parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { unaccountedNumericRefusal } from '../evaluateRequestNumericLiterals';
import { type MetricGoal, type MetricGoalState } from '../metricGoalContractTypes';
import { readRequestMetricNumbers } from '../readRequestMetricNumbers';

type Envelope = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];

function envelope(intent: string): Envelope {
    return {
        schemaVersion: 1,
        runId: 'run',
        batchId: 'batch',
        projectId: 'project',
        baseRevision: 'revision',
        idempotencyKey: 'key',
        intent,
        mode: 'preview',
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        preconditions: [],
        commands: [],
        postconditions: [],
        dependencies: [],
        batchLocalBindings: [],
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: {
            maxCommands: 0,
            maxCreatedTracks: 0,
            maxDeletedObjects: 0,
            maxAffectedTracks: 0,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
    };
}

function state(prompt: string, goals: MetricGoal[]): MetricGoalState {
    return {
        schemaVersion: 1,
        steps: [],
        proofs: [],
        binding: null,
        authorities: [
            {
                schemaVersion: 1,
                authorityId: 'authority',
                origin: 'configured-joint-intake',
                callId: 'call',
                turn: 1,
                catalogId: 'catalog',
                requestDigest: digest(prompt.trim()),
                revision: 'revision',
                projectId: 'project',
                selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
                kind: 'perceptual',
                goals,
                creativeAuthority: null,
            },
        ],
    };
}

const cases = [
    ['-14 LKFS', -14, 'LUFS', 'integratedLoudness'],
    ['-14lkfs', -14, 'LUFS', 'integratedLoudness'],
    ['-1 dB TP', -1, 'dBTP', 'truePeak'],
    ['-1dB\t tp', -1, 'dBTP', 'truePeak'],
    ['3kHz', 3000, 'Hz', 'spectralCentroid'],
    ['2.5 KhZ', 2500, 'Hz', 'spectralCentroid'],
    ['-14 lUfS', -14, 'LUFS', 'integratedLoudness'],
    ['-1dbtp', -1, 'dBTP', 'truePeak'],
    ['-12 DBFS', -12, 'dBFS', 'rms'],
    ['3000 hz', 3000, 'Hz', 'spectralCentroid'],
] as const;

describe('readRequestMetricNumbers', () => {
    it.each(cases)('canonicalizes %s while preserving its source span', (token, value, unit, metricId) => {
        const prompt = `Keep Drums at ${token} please`;
        const start = prompt.indexOf(token);
        expect(readRequestMetricNumbers(prompt)).toEqual([
            { start, candidateId: `number:${start}`, token, value, unit, metricId },
        ]);
    });

    it('keeps multiple candidates in source order with distinct position IDs', () => {
        const prompt = 'Keep -14 LKFS and -1 dB TP with 3kHz';
        expect(readRequestMetricNumbers(prompt)).toEqual([
            {
                start: 5,
                candidateId: 'number:5',
                token: '-14 LKFS',
                value: -14,
                unit: 'LUFS',
                metricId: 'integratedLoudness',
            },
            { start: 18, candidateId: 'number:18', token: '-1 dB TP', value: -1, unit: 'dBTP', metricId: 'truePeak' },
            {
                start: 32,
                candidateId: 'number:32',
                token: '3kHz',
                value: 3000,
                unit: 'Hz',
                metricId: 'spectralCentroid',
            },
        ]);
    });

    it.each(['3kHzExtra', '-14 LKFSx', '-1 dB TPx', '3HzExtra', '-1 dBTPx', '3 watts'])(
        'rejects a non-whole or unknown unit in %s',
        (token) => {
            expect(readRequestMetricNumbers(`Keep Drums at ${token}`)).toEqual([]);
        }
    );

    it.each(cases.slice(0, 6))(
        'blocks or accounts for original %s at its canonical value',
        (token, value, _unit, metricId) => {
            const prompt = `Keep Drums at ${token} please`;
            const start = prompt.indexOf(token);
            const goal: MetricGoal = {
                goalId: 'goal',
                stepId: 'step',
                metricId,
                band: null,
                targetIds: ['drums'],
                referenceTargetIds: [],
                range: null,
                relation: 'target',
                targetValue: value,
                tolerance: 0,
                source: { kind: 'request-number', candidateId: `number:${start}`, token },
            };
            expect(unaccountedNumericRefusal(state(prompt, []), envelope(prompt))).toEqual({
                failure: 'missing',
                reason: `The request's ${token} candidate has no selected metric goal or grounded literal use.`,
            });
            expect(unaccountedNumericRefusal(state(prompt, [goal]), envelope(prompt))).toBeNull();
            expect(
                unaccountedNumericRefusal(state(prompt, [{ ...goal, targetValue: value + 1 }]), envelope(prompt))
            ).toMatchObject({ failure: 'missing' });
        }
    );
});
