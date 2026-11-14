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

describe('a last-commit continuation accounts only for the figure it consumed', () => {
    const PROMPT = '50 Hz more';
    const MISSING = {
        failure: 'missing',
        reason: "The request's 50 Hz candidate has no selected metric goal or grounded literal use.",
    };

    function parameterCommand(commandId: string, value: number): Envelope['commands'][number] {
        return {
            schemaVersion: 1,
            commandId,
            issuedAt: 0,
            operation: 'setDeviceParameter',
            arguments: { deviceId: 'device-eq', paramId: 'eq-low-freq', value },
            argumentsDigest: commandId,
            dependencyIds: [],
            reason: 'continued',
            expectedEffect: 'continued',
            objectReferences: [],
            time: [],
            parameterUnits: [{ argument: 'value', unit: 'Hz' }],
            seed: null,
            normalizedProjectRevision: 'revision',
            availableDeviceVersions: {},
            applicationAssignedIds: [],
        };
    }

    function continuationState(
        prompt: string,
        record: Partial<NonNullable<MetricGoalState['lastCommitContinuations']>[number]> = {}
    ): MetricGoalState {
        return {
            ...state(prompt, []),
            lastCommitContinuations: [
                {
                    kind: 'last-commit-continuation',
                    requestDigest: digest(prompt.trim()),
                    actionIndex: 0,
                    unit: 'Hz',
                    figure: 50,
                    comparative: 'more',
                    committed: 200,
                    landed: 250,
                    ...record,
                },
            ],
        };
    }

    function continuedEnvelope(prompt: string, ...values: number[]): Envelope {
        return {
            ...envelope(prompt),
            commands: values.map((value, index) => parameterCommand(`command-${String(index)}`, value)),
        };
    }

    it('accounts the consumed figure by the action that lands committed plus the figure', () => {
        expect(unaccountedNumericRefusal(continuationState(PROMPT), continuedEnvelope(PROMPT, 250))).toBeNull();
        expect(
            unaccountedNumericRefusal(
                continuationState('50 Hz less', { comparative: 'less', landed: 150 }),
                continuedEnvelope('50 Hz less', 150)
            )
        ).toBeNull();
    });

    it('still refuses a provider-planned figure carrying no continuation record, as before', () => {
        expect(unaccountedNumericRefusal(state(PROMPT, []), continuedEnvelope(PROMPT, 250))).toEqual(MISSING);
    });

    it.each([
        ['records a landed value other than committed plus the figure', { landed: 260 }, 260],
        ['records a direction the landed value does not follow', { comparative: 'less' as const }, 250],
        ['records a landed value the action does not set', {}, 260],
        ['names another figure than the one stated', { figure: 60, landed: 260 }, 260],
        ['names another unit than the one stated', { unit: 'dBFS' as const }, 250],
        ['belongs to another request', { requestDigest: digest('60 Hz more') }, 250],
    ])('does not witness a record that %s', (_name, record, landed) => {
        expect(unaccountedNumericRefusal(continuationState(PROMPT, record), continuedEnvelope(PROMPT, landed))).toEqual(
            MISSING
        );
    });

    it('does not witness a record whose indexed command is another operation setting the landed value', () => {
        // Value 250 and its Hz unit match a witnessed write, so only the operation can refuse it.
        const other: Envelope['commands'][number] = {
            ...parameterCommand('command-0', 250),
            operation: 'setTrackGain',
            arguments: { trackId: 'track-vocals', expectedGain: 1, value: 250 },
        };
        expect(
            unaccountedNumericRefusal(continuationState(PROMPT), { ...envelope(PROMPT), commands: [other] })
        ).toEqual(MISSING);
    });

    it('does not witness a record whose indexed parameter write states its value in another unit', () => {
        const inDecibels: Envelope['commands'][number] = {
            ...parameterCommand('command-0', 250),
            parameterUnits: [{ argument: 'value', unit: 'dB' }],
        };
        expect(
            unaccountedNumericRefusal(continuationState(PROMPT), { ...envelope(PROMPT), commands: [inDecibels] })
        ).toEqual(MISSING);
    });

    it('does not witness a figure the request states twice', () => {
        const prompt = '50 Hz more, 50 Hz more';
        expect(unaccountedNumericRefusal(continuationState(prompt), continuedEnvelope(prompt, 250, 250))).toMatchObject(
            { failure: 'missing' }
        );
    });

    it('does not witness a second figure in the unit the continuation did not consume', () => {
        const prompt = '50 Hz more and 80 Hz';
        expect(unaccountedNumericRefusal(continuationState(prompt), continuedEnvelope(prompt, 250))).toEqual({
            failure: 'missing',
            reason: "The request's 80 Hz candidate has no selected metric goal or grounded literal use.",
        });
    });

    it.each([
        ['another action than the one landing the value', 0, [300, 250]],
        ['no action', 1, [250]],
    ])('does not witness a record whose index names %s', (_name, actionIndex, values) => {
        expect(
            unaccountedNumericRefusal(continuationState(PROMPT, { actionIndex }), continuedEnvelope(PROMPT, ...values))
        ).toEqual(MISSING);
    });
});
