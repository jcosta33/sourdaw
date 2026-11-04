import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { renderAgentMeasurementScope } from '#/modules/AudioRendering/useCases';
import { projectStore, defaultProjectStoreState } from '#/modules/Project/stores';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { admitAnswerInterpretation } from '../admitAnswerInterpretation';
import {
    type AnalysisMeasureRead,
    type AnswerMetricReference,
    type AnswerRespondArguments,
} from '../answerContractTypes';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { getProjectContext } from '../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';

import { createPlanningProject } from './planningProjectFixture';

vi.mock('#/modules/AudioRendering/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/AudioRendering/useCases')>()),
    renderAgentMeasurementScope: vi.fn(),
    retainAgentMeasurementRenders: vi.fn(() => []),
}));

const terminalToolNames = new Set(['answer.respond', 'command.batch.decline', 'command.batch.propose']);
function sine(amplitude = 0.1): AudioBuffer {
    const channel = Float32Array.from(
        { length: 192_000 },
        (_, index) => amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000)
    );
    const buffer = MockAudioBuffer.create(2, 192_000, 48_000);
    buffer.copyToChannel(channel, 0);
    buffer.copyToChannel(channel, 1);
    return buffer;
}
function resultTurn(toolCalls: ToolCallResult[]) {
    return { status: 'complete' as const, toolCalls };
}
function terminal(statements: AnswerRespondArguments['statements'], intakeCallId = 'intake'): ToolCallResult {
    return { id: 'answer', name: 'answer.respond', arguments: { intakeCallId, statements } };
}
const reference = { callId: 'measure', targetId: 'master', metricId: 'integratedLoudness' as const };

function setup(kind = 'measured-audio') {
    const context = getProjectContext();
    context.tracks = [];
    context.sections = [{ id: 'chorus', name: 'Chorus', startBeat: 0, endBeat: 8 }];
    const catalog = prepareAnswerInterpretationCatalog({
        prompt: 'How loud is the master over Chorus?',
        context,
        projectRevision: 'revision',
    });
    const intake: ToolCallResult = {
        id: 'intake',
        name: 'selectAnswerInterpretation',
        arguments: {
            catalogId: catalog.catalogId,
            kind,
            topicIds: kind === 'measured-audio' ? ['level'] : [],
            scopeCandidateIds: kind === 'measured-audio' ? ['master'] : [],
            rangeCandidateId: kind === 'measured-audio' ? 'r0' : null,
            uncertainty: 'none',
        },
    };
    const measure: ToolCallResult = {
        id: 'measure',
        name: 'analysis.measure',
        arguments: { scope: { kind: 'master' }, range: { sectionId: 'chorus' } },
    };
    const execute = vi.fn(async (call: ToolCallResult, { callId, turn }: { callId: string; turn: number }) =>
        executeAnalysisMeasure({
            call,
            callId,
            turn,
            projectRevision: 'revision',
            sections: context.sections ?? [],
            admit: () => ({ status: 'admitted', settle: () => {} }),
        })
    );
    const requestTurns: Array<Parameters<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>[0]> = [];
    function run(
        turns: ToolCallResult[][],
        rewrite?: (result: AnalysisMeasureRead) => AnalysisMeasureRead,
        limits?: { maxReceiptBytesPerCall?: number }
    ) {
        const requestTurn = vi.fn();
        for (const calls of turns) {
            requestTurn.mockImplementationOnce(async (input) => {
                requestTurns.push(input);
                return resultTurn(calls);
            });
        }
        return runApplicationOwnedToolLoop({
            loopId: 'measured-answer',
            terminalToolNames,
            requestTurn,
            limits,
            answerInterpretation: {
                admit: (call) => admitAnswerInterpretation({ catalog, call, projectRevision: 'revision' }),
            },
            measurement: {
                toolName: 'analysis.measure',
                revision: 'revision',
                execute: async (call, info) => {
                    const result = await execute(call, info);
                    return rewrite?.(result) ?? result;
                },
            },
        });
    }
    return { intake, measure, run, execute, context, catalog, requestTurns };
}

beforeEach(() => {
    vi.clearAllMocks();
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
        initialized: true,
        loading: false,
    });
    vi.mocked(renderAgentMeasurementScope).mockImplementation(async ({ scope }) => ({
        status: 'rendered',
        soloActive: false,
        warnings: [],
        targets: (scope.kind === 'master' ? ['master'] : scope.ids).map((targetId) => ({
            targetId,
            targetKind: targetId === 'master' ? 'master' : 'track',
            route: targetId === 'master' ? 'mixdown' : 'isolated-subgraph',
            liveAudibility: 'audible',
            buffer: sine(targetId === 'b' ? 0.2 : 0.1),
            artifact: {
                contentAddress: `sha256:${targetId}`,
                sampleRate: 48_000,
                frameCount: 192_000,
                channelCount: 2,
                durationSeconds: 4,
            },
        })),
    }));
});
afterEach(() => vi.restoreAllMocks());

describe('AC002 measured answers use actual successful audio reductions', () => {
    it('composes master LUFS and true peak from the actual producer, after intake', async () => {
        const { intake, measure, run } = setup();
        const result = await run([
            [intake],
            [measure],
            [
                terminal([
                    { kind: 'metric', reference },
                    { kind: 'metric', reference: { ...reference, metricId: 'truePeak' } },
                ]),
            ],
        ]);
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') {
            throw new Error(result.reason);
        }
        expect(result.answer?.text).toContain('Over “Chorus” (beats 0–8), Master output integrated loudness is');
        expect(result.answer?.text).toContain('integrated loudness is -19.99 LUFS (exact)');
        expect(result.answer?.text).toContain('true peak is -19.99 dBTP (exact)');
        expect(result.answer?.evidence.map((entry) => entry.callId)).toEqual(['intake', 'measure']);
        expect(renderAgentMeasurementScope).toHaveBeenCalledTimes(1);
        expect(result.retainedCompilations).toEqual([]);
        expect(result.proposal).toBeNull();
    });
    it('consumes the strict entry fallback as an ordinary turn without another allowance or early answer', async () => {
        const { intake, measure, run, requestTurns } = setup();
        const result = await run([
            [{ id: 'entry', name: 'answer.respond', arguments: {} }],
            [intake],
            [measure],
            [terminal([{ kind: 'metric', reference }])],
        ]);
        expect(result).toMatchObject({
            status: 'complete',
            turns: 4,
            answer: { text: expect.stringContaining('integrated loudness is -19.99 LUFS') },
        });
        expect(requestTurns.map((turn) => turn.remaining.turns)).toEqual([4, 3, 3, 2]);
        expect(requestTurns[1]?.answerIntakeOnly).toBe(true);
        expect(requestTurns[2]?.answerOnly).toBe(true);
        expect(result.receipts.map((receipt) => receipt.callId)).toEqual(['entry', 'intake', 'measure']);
        expect(result.status === 'complete' ? result.answer?.evidence.map((entry) => entry.callId) : null).toEqual([
            'intake',
            'measure',
        ]);
        expect(renderAgentMeasurementScope).toHaveBeenCalledTimes(1);
    });
    it('renders a structural answer without an offline render, with intake evidence', async () => {
        const { intake, run } = setup('project-facts');
        const result = await run([[intake], [terminal([{ kind: 'project-fact', fact: 'summary' }])]]);
        expect(result).toMatchObject({
            status: 'complete',
            answer: {
                text: 'The project has 0 audio/MIDI track(s), 0 bus(es), and 0 folder(s). Master output is separate. Tempo is 120 BPM in 4/4.',
                evidence: [expect.objectContaining({ callId: 'intake' })],
            },
        });
        expect(renderAgentMeasurementScope).not.toHaveBeenCalled();
    });
    it('describes master-only project truth as zero audio/MIDI tracks', async () => {
        const { intake, run, catalog } = setup('project-facts');
        const context = createPlanningProject(getProjectContext(), 1);
        catalog.context.tracks = [
            { ...context.tracks[0]!, id: 'master-node', name: 'Master', kind: 'master', clips: [] },
        ];
        const result = await run([[intake], [terminal([{ kind: 'project-fact', fact: 'summary' }])]]);
        expect(result).toMatchObject({
            status: 'complete',
            answer: {
                text: 'The project has 0 audio/MIDI track(s), 0 bus(es), and 0 folder(s). Master output is separate. Tempo is 120 BPM in 4/4.',
            },
        });
        expect(renderAgentMeasurementScope).not.toHaveBeenCalled();
    });

    it.each(['project-fact', 'recipe'] as const)(
        'a measured obligation cannot evade measurement with %s',
        async (kind) => {
            const { intake, run } = setup();
            let statements: AnswerRespondArguments['statements'];
            if (kind === 'project-fact') {
                statements = [{ kind, fact: 'summary' }];
            } else {
                statements = [{ kind, callId: 'recipe', recipeId: 'vocal-warm' }];
            }
            const result = await run([[intake], [terminal(statements)]]);
            expect(result).toMatchObject({
                status: 'complete',
                answer: { text: expect.stringContaining('cannot report audio figures') },
            });
        }
    );
    it('refuses contradictory unavailable prose and an empty measured reply after a successful measurement', async () => {
        const { intake, measure, run } = setup();
        expect(
            (
                await run([
                    [intake],
                    [measure],
                    [
                        terminal([
                            { kind: 'metric', reference },
                            { kind: 'limitation', code: 'measurement-unavailable' },
                        ]),
                    ],
                ])
            ).status
        ).toBe('rejected');
        expect((await run([[intake], [measure], [terminal([{ kind: 'project-fact', fact: 'summary' }])]])).status).toBe(
            'rejected'
        );
    });

    it('never treats a real recipe receipt as acoustic measurement evidence', async () => {
        const { intake, measure, run } = setup();
        const result = await run([
            [intake],
            [measure, { id: 'recipe', name: 'recipe.discover', arguments: { descriptors: ['warm'], limit: 1 } }],
            [terminal([{ kind: 'metric', reference: { ...reference, callId: 'recipe' } }])],
        ]);
        expect(result.status).toBe('rejected');
        expect(result.receipts.find((receipt) => receipt.callId === 'recipe')?.status).toBe('success');
    });

    it('normalizes rounded negative zero without accepting a provider value', async () => {
        const { intake, measure, run } = setup();
        const result = await run(
            [
                [intake],
                [measure],
                [terminal([{ kind: 'metric', reference: { ...reference, metricId: 'stereoCorrelation' } }])],
            ],
            (produced) => {
                const copy = structuredClone(produced);
                copy.answerMeasurement!.targets = copy.answerMeasurement!.targets.map((target) => ({
                    ...target,
                    measurements: {
                        ...target.measurements,
                        stereoCorrelation: {
                            status: 'measured',
                            metricVersion: 1,
                            confidence: 'exact',
                            value: -0.00001,
                            unit: 'correlation',
                        },
                    },
                }));
                return copy;
            }
        );
        expect(result).toMatchObject({
            status: 'complete',
            answer: { text: expect.stringContaining('stereo correlation is 0 correlation') },
        });
        if (result.status === 'complete') {
            expect(result.answer?.text).not.toContain('-0');
        }
    });

    it('does not reuse a successful pre-intake measurement', async () => {
        const { intake, measure, run } = setup();
        const result = await run([[measure], [intake], [terminal([{ kind: 'metric', reference }])]]);
        expect(result).toMatchObject({
            status: 'complete',
            answer: { text: expect.stringContaining('cannot report audio figures') },
        });
    });
    it.each(['revision', 'range', 'scope', 'failed', 'oversized', 'artifact'] as const)(
        'cannot use %s measurement evidence',
        async (defect) => {
            const { intake, measure, run } = setup();
            const result = await run([[intake], [measure], [terminal([{ kind: 'metric', reference }])]], (produced) => {
                const copy = structuredClone(produced);
                if (defect === 'failed') {
                    copy.receipt.status = 'failure';
                }
                if (defect === 'oversized') {
                    copy.receipt.summary = 'x'.repeat(20_000);
                }
                if (copy.answerMeasurement) {
                    const value = copy.answerMeasurement;
                    if (defect === 'revision') {
                        value.revision = 'different';
                    }
                    if (defect === 'range') {
                        value.range.endBeat = 4;
                    }
                    if (defect === 'scope') {
                        value.scope = { kind: 'tracks', ids: ['other'] };
                    }
                    if (defect === 'artifact') {
                        value.targets = value.targets.map((target) => ({
                            ...target,
                            artifact: { contentAddress: '' },
                        }));
                    }
                }
                return copy;
            });
            expect(result).toMatchObject({
                status: 'complete',
                answer: { text: expect.stringContaining('cannot report audio figures') },
            });
        }
    );
    it.each(['foreign-call', 'wrong-target', 'nonfinite', 'map', 'wrong-unit', 'wrong-band'] as const)(
        'rejects %s reference without invented figures',
        async (defect) => {
            const { intake, measure, run } = setup();
            const ref: AnswerMetricReference = structuredClone(reference);
            if (defect === 'foreign-call') {
                ref.callId = 'foreign';
            }
            if (defect === 'wrong-target') {
                ref.targetId = 'foreign';
            }
            if (defect === 'wrong-band') {
                ref.metricId = 'frequencyBandEnergy';
                ref.band = 'invented-band';
            }
            const result = await run(
                [[intake], [measure], [terminal([{ kind: 'metric', reference: ref }])]],
                (produced) => {
                    if (
                        !produced.answerMeasurement ||
                        ['foreign-call', 'wrong-target', 'wrong-band'].includes(defect)
                    ) {
                        return produced;
                    }
                    const copy = structuredClone(produced);
                    const measurement = copy.answerMeasurement!;
                    measurement.targets = measurement.targets.map((target) => ({
                        ...target,
                        measurements: {
                            ...target.measurements,
                            integratedLoudness: {
                                status: 'measured',
                                metricVersion: 1,
                                confidence: 'exact',
                                unit: defect === 'wrong-unit' ? 'dB' : 'LUFS',
                                value: defect === 'map' ? { low: -14 } : Number.NaN,
                            },
                        },
                    }));
                    return copy;
                }
            );
            expect(result.status).toBe('rejected');
        }
    );
    it.each(['command.batch.propose', 'recipe.expand', 'selectCreativeInterpretation', 'setTempo'] as const)(
        'answer intake cannot grant %s',
        async (name) => {
            const { intake, run, execute } = setup();
            const result = await run([[intake], [{ id: 'mutate', name, arguments: {} }]]);
            expect(result.status).toBe('rejected');
            expect(execute).not.toHaveBeenCalled();
        }
    );
    it('rejects a preview before it renders', async () => {
        const { intake, measure, run, execute } = setup();
        const result = await run([
            [intake],
            [{ ...measure, arguments: { ...measure.arguments, subject: 'preview', proposal: {} } }],
        ]);
        expect(result.status).toBe('rejected');
        expect(execute).not.toHaveBeenCalled();
    });
    it('rejects repeated and mixed intake before effects', async () => {
        const { intake, measure, run, execute } = setup();
        expect((await run([[intake, measure]])).status).toBe('rejected');
        expect((await run([[intake], [{ ...intake, id: 'intake-again' }]])).status).toBe('rejected');
        expect(execute).not.toHaveBeenCalled();
    });
    it('a decline cannot publish provider-authored numeric fallback prose', async () => {
        const { intake, run } = setup();
        const result = await run([
            [intake],
            [
                {
                    id: 'decline',
                    name: 'command.batch.decline',
                    arguments: {
                        kind: 'clarify',
                        reason: 'The master is minus fourteen LUFS.',
                        questions: ['Use seven decibels?'],
                    },
                },
            ],
        ]);
        expect(result).toMatchObject({
            status: 'complete',
            decline: {
                reason: 'This question cannot be answered from the available evidence.',
                questions: ['Please clarify the question, target or range to analyze.'],
            },
        });
        expect(JSON.stringify(result.status === 'complete' ? result.decline : null)).not.toMatch(/fourteen|seven/);
    });
    it('unsupported timing quantities produce an application limitation without figures', async () => {
        const { intake, run } = setup();
        intake.arguments.topicIds = ['timing'];
        const result = await run([[intake], [terminal([{ kind: 'limitation', code: 'timing-unavailable' }])]]);
        expect(result).toMatchObject({
            status: 'complete',
            answer: { text: expect.stringContaining('Track alignment and timing offsets are unavailable') },
        });
        expect(renderAgentMeasurementScope).not.toHaveBeenCalled();
    });
    it('does not turn a successful acoustic measurement into timing or alignment figures', async () => {
        const { intake, measure, run } = setup();
        intake.arguments.topicIds = ['timing'];
        const result = await run([[intake], [measure], [terminal([{ kind: 'metric', reference }])]]);
        expect(result).toMatchObject({
            status: 'complete',
            answer: {
                text: 'Track alignment and timing offsets are unavailable from these measurements. Source-buffer onsets do not establish track alignment.',
                evidence: [expect.objectContaining({ callId: 'intake' })],
            },
        });
        expect(renderAgentMeasurementScope).toHaveBeenCalledTimes(1);
        expect(result.receipts.find((receipt) => receipt.callId === 'measure')?.status).toBe('success');
    });
    it('computes loudness differences in LU and preserves ranking ties over the complete selected set', async () => {
        const { intake, measure, run, catalog } = setup();
        catalog.scopes.push({
            candidateId: 'pair',
            kind: 'tracks',
            objectIds: ['a', 'b', 'c'],
            labels: ['Vocal 2 **LUFS**', 'Bass', 'Drums'],
        });
        intake.arguments.scopeCandidateIds = ['pair'];
        measure.arguments.scope = { kind: 'tracks', ids: ['a', 'b', 'c'] };
        const a = { ...reference, targetId: 'a' };
        const b = { ...reference, targetId: 'b' };
        const c = { ...reference, targetId: 'c' };
        const result = await run([
            [intake],
            [measure],
            [
                terminal([
                    { kind: 'difference', left: b, right: a },
                    { kind: 'ranking', references: [b, a, c], operation: 'descending' },
                ]),
            ],
        ]);
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') {
            throw new Error(result.reason);
        }
        expect(result.answer?.text).toContain('6.02 LU');
        expect(result.answer?.text).toContain('tied:');
        expect(result.answer?.text).toContain('Vocal 2 \\*\\*LUFS\\*\\*');
        expect(result.answer?.text).toContain('does not establish perceived quality');
    });
    it('rejects a ranking that silently omits an interpreted target', async () => {
        const { intake, measure, run, catalog } = setup();
        catalog.scopes.push({ candidateId: 'pair', kind: 'tracks', objectIds: ['a', 'b'], labels: ['A', 'B'] });
        intake.arguments.scopeCandidateIds = ['pair'];
        measure.arguments.scope = { kind: 'tracks', ids: ['a', 'b'] };
        const result = await run([
            [intake],
            [measure],
            [terminal([{ kind: 'ranking', references: [{ ...reference, targetId: 'a' }], operation: 'maximum' }])],
        ]);
        expect(result.status).toBe('rejected');
    });
    it.each([false, true])('rejects an omitted selected track when silence is %s', async (silent) => {
        const context = createPlanningProject(getProjectContext(), 2);
        context.tracks = context.tracks.map((track, index) => ({
            ...track,
            name: index === 0 ? 'AudibleA' : 'TrackB',
        }));
        const ids = context.tracks.map((track) => track.id);
        const catalog = prepareAnswerInterpretationCatalog({
            prompt: 'Which of AudibleA and TrackB is louder over Chorus?',
            context,
            projectRevision: 'revision',
        });
        const scopeCandidateIds = ids.map((id) => {
            const scope = catalog.scopes.find((entry) => entry.kind === 'tracks' && entry.objectIds[0] === id);
            if (scope === undefined) {
                throw new Error('Missing track scope');
            }
            return scope.candidateId;
        });
        const chorus = catalog.ranges.find((range) => range.label === 'Chorus');
        if (chorus === undefined) {
            throw new Error('Missing Chorus');
        }
        const intake: ToolCallResult = {
            id: 'intake',
            name: 'selectAnswerInterpretation',
            arguments: {
                catalogId: catalog.catalogId,
                kind: 'measured-audio',
                topicIds: ['level'],
                scopeCandidateIds,
                rangeCandidateId: chorus.candidateId,
                uncertainty: 'none',
            },
        };
        expect(admitAnswerInterpretation({ catalog, call: intake, projectRevision: 'revision' })).toMatchObject({
            status: 'admitted',
            authority: { scopes: [{ kind: 'tracks', objectIds: ids }], range: { startBeat: 48, endBeat: 80 } },
        });
        const measure: ToolCallResult = {
            id: 'measure',
            name: 'analysis.measure',
            arguments: { scope: { kind: 'tracks', ids }, range: { sectionId: chorus.sectionId } },
        };
        vi.mocked(renderAgentMeasurementScope).mockImplementation(async ({ scope }) => ({
            status: 'rendered',
            soloActive: false,
            warnings: [],
            targets: (scope.kind === 'master' ? ['master'] : scope.ids).map((targetId) => {
                const frames = 768_000;
                const buffer = MockAudioBuffer.create(2, frames, 48_000);
                const amplitude = silent && targetId === ids[1] ? 0 : 0.1;
                const channel = Float32Array.from(
                    { length: frames },
                    (_, index) => amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000)
                );
                buffer.copyToChannel(channel, 0);
                buffer.copyToChannel(channel, 1);
                return {
                    targetId,
                    targetKind: 'track',
                    route: 'isolated-subgraph',
                    liveAudibility: 'audible',
                    buffer,
                    artifact: {
                        contentAddress: `sha256:${targetId}`,
                        sampleRate: 48_000,
                        frameCount: frames,
                        channelCount: 2,
                        durationSeconds: 16,
                    },
                };
            }),
        }));
        const requestTurn = vi.fn();
        for (const calls of [
            [intake],
            [measure],
            [terminal([{ kind: 'metric', reference: { ...reference, targetId: ids[0]! } }])],
        ]) {
            requestTurn.mockResolvedValueOnce(resultTurn(calls));
        }
        const result = await runApplicationOwnedToolLoop({
            loopId: 'incomplete-selected-scope',
            terminalToolNames,
            requestTurn,
            answerInterpretation: {
                admit: (call) => admitAnswerInterpretation({ catalog, call, projectRevision: 'revision' }),
            },
            measurement: {
                toolName: 'analysis.measure',
                revision: 'revision',
                execute: async (call, { callId, turn }) => {
                    const read = await executeAnalysisMeasure({
                        call,
                        callId,
                        turn,
                        projectRevision: 'revision',
                        sections: context.sections ?? [],
                        admit: () => ({ status: 'admitted', settle: () => {} }),
                    });
                    expect(read.answerMeasurement?.targets[0]?.measurements.integratedLoudness?.status).toBe(
                        'measured'
                    );
                    expect(read.answerMeasurement?.targets[1]?.measurements.integratedLoudness).toMatchObject(
                        silent ? { status: 'unavailable', reason: 'silent' } : { status: 'measured' }
                    );
                    return read;
                },
            },
        });
        expect(result.status).toBe('rejected');
        expect(result.receipts.find((receipt) => receipt.callId === 'measure')?.status).toBe('success');
    });
    it('a semantic structural misclassification cannot smuggle metric prose', async () => {
        const { intake, run } = setup('project-facts');
        const result = await run([
            [intake],
            [
                {
                    id: 'answer',
                    name: 'answer.respond',
                    arguments: { text: 'The master is fourteen LUFS', evidenceCallIds: [] },
                },
            ],
        ]);
        expect(result.status).toBe('rejected');
        expect(renderAgentMeasurementScope).not.toHaveBeenCalled();
    });
});
