import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { planPromptActions } from '../planPromptActions';

import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import { literalMetricIntakeTurn, readMetricPublication } from './metricGoalWorkflowFixture';

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(),
    };
});

vi.mock('../getProjectContext', () => ({
    getProjectContext: vi.fn(() => context),
}));

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        {
            id: 'track-bass',
            name: 'Bass',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            frozen: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            outputId: 'master',
            clipCount: 2,
            deviceCount: 0,
            clips: [
                { id: 'clip-bass', name: 'Bass Verse', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 },
                { id: 'clip-lead', name: 'Lead', type: 'audio', startBeat: 8, endBeat: 16, noteCount: 0 },
            ],
            devices: [],
            sends: [],
        },
    ],
    selectedTrackId: 'track-bass',
    selectedClipId: 'clip-lead',
    selectedClipIds: ['clip-lead'],
    activeView: 'arrange',
    playheadPosition: 0,
};

const plan = {
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Execute the grounded command batch.',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
};

const discoverTurn = (names: readonly string[]) => ({
    status: 'complete' as const,
    toolCalls: [{ id: 'discover-1', name: 'agent.catalog.discover', arguments: { category: 'command', names } }],
});

const proposeCommandsTurn = (commands: ReadonlyArray<Record<string, unknown>>) => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'propose-1',
            name: 'command.batch.propose',
            arguments: { commands, plan },
        },
    ],
});

const proposeListTurn = (items: ReadonlyArray<Record<string, unknown>>) => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'propose-1',
            name: 'command.batch.propose',
            arguments: { plan, list: { schemaVersion: 1, items } },
        },
    ],
});

const declineTurn = () => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'decline-1',
            name: 'command.batch.decline',
            arguments: {
                kind: 'clarify',
                reason: 'The scripted provider only repairs when the rejection diagnostic arrives.',
                questions: ['Which track should change?'],
            },
        },
    ],
});

function bluesIntake(userMessage: string, schemas: readonly ToolSchema[]) {
    const base = selectCreativeInterpretationCall({
        catalog: readCreativeInterpretationCatalog(userMessage, schemas),
        modeId: 'create',
        targetObjectIds: ['track-bass'],
        dimensions: ['processing', 'arrangement'],
        creationSlotObjectTypes: ['track'],
    });
    const schema = schemas.find((candidate) => candidate.function.name === base.name);
    if (schema === undefined) {
        throw new TypeError('Expected the published joint intake schema');
    }
    const objective = readMetricPublication(schema).find((candidate) => candidate.kind === 'unsupported');
    if (objective === undefined) {
        throw new TypeError('Expected the published unsupported objective');
    }
    return {
        status: 'complete' as const,
        toolCalls: [
            {
                ...base,
                id: 'intake',
                arguments: {
                    ...base.arguments,
                    answer: null,
                    metricIntent: {
                        kind: 'perceptual',
                        uncertainty: 'none',
                        objectives: [
                            {
                                objectiveId: objective.id,
                                scopeCandidateId: null,
                                referenceScopeCandidateId: null,
                                rangeCandidateId: null,
                            },
                        ],
                    },
                },
            },
        ],
    };
}

type UserMessageSection = Record<string, unknown>;

function parseSection(userMessage: string, section: string): UserMessageSection | null {
    const marker = `${section}:\n`;
    const start = userMessage.indexOf(marker);
    if (start < 0) {
        return null;
    }
    const valueStart = start + marker.length;
    const valueEnd = userMessage.indexOf('\n', valueStart);
    try {
        return JSON.parse(userMessage.slice(valueStart, valueEnd < 0 ? undefined : valueEnd)) as UserMessageSection;
    } catch {
        return null;
    }
}

/** Bounded strings serialize as {value, truncated}; unwrap for assertions. */
function text(value: unknown): string {
    return typeof value === 'string' ? value : ((value as { value?: string }).value ?? '');
}

const { generateToolPlanningOutcome } = await import('../llmOrchestration/inference');

describe('planPromptActions bounded correction evidence', () => {
    beforeEach(() => {
        vi.mocked(generateToolPlanningOutcome).mockReset();
        agentRunLifecycle.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('plan correction evidence spec');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
    });

    afterEach(() => {
        agentRunLifecycle.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('repairs a rejected command only when the correction names the failing item and constraint', async () => {
        let turn = 0;
        let correctionDiagnostic: UserMessageSection | null = null;
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_systemPrompt, userMessage, schemas) => {
            turn += 1;
            if (turn === 1 || turn === 5) {
                return bluesIntake(userMessage, schemas);
            }
            if (turn === 2 || turn === 6) {
                return discoverTurn(['addTrack', 'setTrackPan']);
            }
            if (turn === 3) {
                // The invalid multi-step proposal: one creation plus one
                // command whose pan value violates the app-owned range.
                return proposeListTurn([
                    {
                        id: 'make-track',
                        name: 'addTrack',
                        arguments: { name: 'Blues Comp', kind: 'midi', binding: 'kit' },
                    },
                    {
                        id: 'pan-bass',
                        name: 'setTrackPan',
                        arguments: { pan: -300 },
                        selector: {
                            targetArgument: 'trackId',
                            entity: 'track',
                            where: { name: 'Bass' },
                            quantity: { unit: 'targets', exactly: 1 },
                        },
                    },
                ]);
            }
            if (turn === 4 || turn === 8) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: `measurement-${turn}`,
                            name: 'analysis.measure',
                            arguments: { scope: { kind: 'master' }, range: { sectionId: 'missing-section' } },
                        },
                    ],
                };
            }
            const failures = parseSection(userMessage, 'validation_failures');
            correctionDiagnostic = (failures?.correction as UserMessageSection | undefined) ?? null;
            const evidence = correctionDiagnostic as {
                kind?: string;
                command?: { name?: unknown };
                reason?: unknown;
                rejectedFragment?: { value?: string };
            } | null;
            if (
                evidence === null ||
                evidence.kind !== 'constraint' ||
                text(evidence.command?.name) !== 'setTrackPan' ||
                !text(evidence.reason).includes('pan from -50 through 50') ||
                !evidence.rejectedFragment?.value?.includes('-300')
            ) {
                // The provider refuses to guess: without the diagnostic it
                // declines, which fails the batch and this test.
                return declineTurn();
            }
            // The correction changes the invalid item and preserves the valid one.
            return proposeListTurn([
                {
                    id: 'make-track',
                    name: 'addTrack',
                    arguments: { name: 'Blues Comp', kind: 'midi', binding: 'kit' },
                },
                {
                    id: 'pan-bass',
                    name: 'setTrackPan',
                    arguments: { pan: -30 },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { name: 'Bass' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ]);
        });

        const result = await planPromptActions({
            prompt: 'create a blues song with a twelve bar progression and pan the Bass track left',
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        expect(correctionDiagnostic).not.toBeNull();
        // One bounded correction: intake, discovery, proposal and measurement on each attempt.
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(8);
        expect(result.result.rejectionReason).toBeUndefined();
        expect(result.result.actions.map((action) => action.type)).toEqual(['addTrack', 'setTrackPan']);
        // The corrected creative plan has no measurement proof and does not claim approval.
        expect(metricGoalStateCodec(result.result.metricGoalState)).toMatchObject({
            authorities: [{ kind: 'perceptual', goals: [{ relation: 'unsupported' }] }],
            proofs: [],
        });
        const panAction = result.result.actions.find((action) => action.type === 'setTrackPan');
        expect(panAction).toMatchObject({ payload: { trackId: 'track-bass', pan: -30 } });
    });

    it('delivers a missing-target diagnostic for a selector that resolves nothing, then repairs it', async () => {
        let turn = 0;
        let correctionDiagnostic: UserMessageSection | null = null;
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_systemPrompt, userMessage, schemas) => {
            turn += 1;
            if (turn === 1 || turn === 4) {
                return { status: 'complete', toolCalls: literalMetricIntakeTurn(userMessage, schemas) };
            }
            if (turn === 2 || turn === 5) {
                return discoverTurn(['renameClip']);
            }
            if (turn === 3) {
                return proposeListTurn([
                    {
                        id: 'rename-ghost',
                        name: 'renameClip',
                        arguments: { name: 'Bridge Solo' },
                        selector: {
                            targetArgument: 'clipId',
                            entity: 'clip',
                            where: { name: 'Ghost Clip' },
                            quantity: { unit: 'targets', exactly: 1 },
                        },
                    },
                ]);
            }
            const failures = parseSection(userMessage, 'validation_failures');
            correctionDiagnostic = (failures?.correction as UserMessageSection | undefined) ?? null;
            const evidence = correctionDiagnostic as {
                kind?: string;
                reason?: string;
                resolution?: { resolvedCount?: number; expectedCount?: number };
            } | null;
            if (
                evidence === null ||
                evidence.kind !== 'missing-target' ||
                evidence.resolution?.resolvedCount !== 0 ||
                evidence.resolution?.expectedCount !== 1
            ) {
                return declineTurn();
            }
            return proposeCommandsTurn([
                { name: 'renameClip', arguments: { clipId: 'clip-lead', name: 'Bridge Solo' } },
            ]);
        });

        const result = await planPromptActions({
            prompt: 'rename Lead to Bridge Solo',
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        expect(correctionDiagnostic).toMatchObject({
            kind: 'missing-target',
            resolution: { resolvedCount: 0, expectedCount: 1 },
        });
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(6);
        expect(result.result.rejectionReason).toBeUndefined();
        expect(result.result.actions).toMatchObject([{ type: 'renameClip', payload: { name: 'Bridge Solo' } }]);
    });

    it('separates an ambiguous-target diagnostic from a missing one before the provider disambiguates', async () => {
        let turn = 0;
        const corrections: Array<UserMessageSection> = [];
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_systemPrompt, userMessage, schemas) => {
            turn += 1;
            if (turn === 1 || turn === 4) {
                return { status: 'complete', toolCalls: literalMetricIntakeTurn(userMessage, schemas) };
            }
            if (turn === 2 || turn === 5) {
                return discoverTurn(['renameClip']);
            }
            if (turn === 3) {
                // Every clip matches a type-only selector — ambiguous.
                return proposeListTurn([
                    {
                        id: 'rename-verse',
                        name: 'renameClip',
                        arguments: { name: 'Chosen Verse' },
                        selector: {
                            targetArgument: 'clipId',
                            entity: 'clip',
                            where: { type: 'audio' },
                            quantity: { unit: 'targets', exactly: 1 },
                        },
                    },
                ]);
            }
            const failures = parseSection(userMessage, 'validation_failures');
            const correctionDiagnostic = (failures?.correction as UserMessageSection | undefined) ?? null;
            corrections.push(correctionDiagnostic as UserMessageSection);
            const evidence = correctionDiagnostic as {
                kind?: string;
                candidateIds?: string[];
                resolution?: { resolvedCount?: number };
            } | null;
            if (
                evidence === null ||
                evidence.kind !== 'ambiguous-target' ||
                evidence.resolution?.resolvedCount !== 3 ||
                !Array.isArray(evidence.candidateIds)
            ) {
                return declineTurn();
            }
            // The diagnostic's candidate list is what lets the provider pick a
            // selector that resolves exactly one of the named candidates.
            return proposeListTurn([
                {
                    id: 'rename-bass-verse',
                    name: 'renameClip',
                    arguments: { name: 'Chosen Verse' },
                    selector: {
                        targetArgument: 'clipId',
                        entity: 'clip',
                        where: { name: 'Bass Verse' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ]);
        });

        const contextWithVerses: ProjectContext = {
            ...context,
            tracks: [
                {
                    ...context.tracks[0]!,
                    clips: [
                        { id: 'clip-bass', name: 'Bass Verse', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 },
                        { id: 'clip-lead', name: 'Lead', type: 'audio', startBeat: 8, endBeat: 16, noteCount: 0 },
                    ],
                },
                {
                    ...context.tracks[0]!,
                    id: 'track-guitar',
                    name: 'Guitar',
                    clips: [
                        {
                            id: 'clip-guitar-verse',
                            name: 'Guitar Verse',
                            type: 'audio',
                            startBeat: 8,
                            endBeat: 16,
                            noteCount: 0,
                        },
                    ],
                },
            ],
        };
        const { getProjectContext } = await import('../getProjectContext');
        vi.mocked(getProjectContext).mockReturnValue(contextWithVerses);

        const result = await planPromptActions({
            prompt: 'rename Bass Verse to Chosen Verse',
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        const diagnostic = corrections.at(-1);
        if (diagnostic === undefined) {
            throw new Error('Expected the correction diagnostic to arrive');
        }
        expect(diagnostic).toMatchObject({
            kind: 'ambiguous-target',
            resolution: { resolvedCount: 3, expectedCount: 1 },
        });
        expect(diagnostic.candidateIds).toEqual(
            expect.arrayContaining(['clip-bass', 'clip-lead', 'clip-guitar-verse'])
        );
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(6);
        expect(result.result.rejectionReason).toBeUndefined();
        expect(result.result.actions).toMatchObject([{ type: 'renameClip', payload: { name: 'Chosen Verse' } }]);
    });
});

// The compile-level guard: a selector that matches nothing is missing, one that
// matches too much is ambiguous — recorded where the correction reads it.
describe('compileArbitraryCommandList selector detail', () => {
    it('records zero resolutions as a missing target', () => {
        const result = compileArbitraryCommandList({
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan,
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'rename-ghost',
                                    name: 'renameClip',
                                    arguments: { name: 'Bridge Solo' },
                                    selector: {
                                        targetArgument: 'clipId',
                                        entity: 'clip',
                                        where: { name: 'Ghost Clip' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
            context,
            revision: 'revision-1',
        });

        expect(result).toMatchObject({
            status: 'rejected',
            detail: {
                kind: 'missing-target',
                itemId: 'rename-ghost',
                entity: 'clip',
                resolvedCount: 0,
                expectedCount: 1,
                candidateIds: [],
            },
        });
    });
});
