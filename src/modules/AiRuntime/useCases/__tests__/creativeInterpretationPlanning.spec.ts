import { beforeEach, describe, expect, it, vi } from 'vitest';

import { querySemanticProject } from '#/modules/Project/useCases';

import { type CreativeRequestAuthority } from '../../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome),
    };
});

// The compiler runs for real; the spy exists only to read the evidence it produced, which no result
// field exposes.
vi.mock('../compileArbitraryCommandList', async (importOriginal) => {
    const original = await importOriginal<typeof import('../compileArbitraryCommandList')>();
    return {
        ...original,
        compileArbitraryCommandList: vi.fn(original.compileArbitraryCommandList),
    };
});

const bassTrack: ProjectContextTrack = {
    id: 'track-bass',
    name: 'Bass',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 0,
    deviceCount: 0,
    clips: [],
    devices: [],
};

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [bassTrack],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const REVISION = 'revision-creative-planning';
const PROMPT = 'set the Bass track gain to 0.5';

const catalog = prepareCreativeInterpretationCatalog({ prompt: PROMPT, context, projectRevision: REVISION });

const queryTurn = {
    status: 'complete' as const,
    toolCalls: [{ id: 'query-1', name: 'project.query', arguments: { type: 'project-summary' } }],
};

const searchTurn = {
    status: 'complete' as const,
    toolCalls: [{ id: 'search-1', name: 'agent.command-index.search', arguments: { intent: 'set a track gain' } }],
};

const discoverTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'discover-1',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['setTrackGain'] },
        },
    ],
};

const interpretationTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'interpretation-1',
            name: 'selectCreativeInterpretation',
            arguments: {
                catalogId: catalog.catalogId,
                modeId: 'edit',
                targetCandidateIds: ['target-1'],
                editDimensionCandidateIds: ['dimension-processing'],
                constraintCandidateIds: [],
                creationSlotIds: [],
                uncertainty: 'none',
            },
        },
    ],
};

const differentInterpretationTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'interpretation-2',
            name: 'selectCreativeInterpretation',
            arguments: {
                catalogId: catalog.catalogId,
                modeId: 'edit',
                targetCandidateIds: ['target-1'],
                editDimensionCandidateIds: ['dimension-arrangement'],
                constraintCandidateIds: [],
                creationSlotIds: [],
                uncertainty: 'none',
            },
        },
    ],
};

const gainCommands = [{ name: 'setTrackGain', arguments: { trackId: 'track-bass', gain: 0.5 } }];

const batchPlan = {
    semantic: { classification: 'simple' as const, uncertainty: [] },
    objective: 'Execute the grounded command batch.',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: ['setTrackGain'],
    assetIds: [],
    alternatives: [],
    validationStrategy: ['Validate the grounded command batch.'],
    stoppingConditions: ['Stop if application validation fails.'],
};

const proposeTurn = (extraArguments: Record<string, unknown> = {}) => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'propose-1',
            name: 'command.batch.propose',
            arguments: {
                commands: gainCommands,
                plan: batchPlan,
                ...extraArguments,
            },
        },
    ],
});

const listProposeTurn = (input: {
    itemArguments: Record<string, unknown>;
    trackName?: string;
    objective?: string;
}) => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'propose-list-1',
            name: 'command.batch.propose',
            arguments: {
                plan: { ...batchPlan, objective: input.objective ?? batchPlan.objective },
                list: {
                    schemaVersion: 1,
                    items: [
                        {
                            id: 'gain-1',
                            name: 'setTrackGain',
                            arguments: input.itemArguments,
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: input.trackName ?? 'Bass' },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        },
                    ],
                },
            },
        },
    ],
});

function readCompilation() {
    const compilations = vi.mocked(compileArbitraryCommandList).mock.results;
    expect(compilations).toHaveLength(1);
    const compilation = compilations[0];
    return compilation?.type === 'return' ? compilation.value : undefined;
}

function scriptTurns(turns: ReadonlyArray<{ status: 'complete'; toolCalls: unknown[] }>) {
    const mocked = vi.mocked(generateToolPlanningOutcome);
    for (const turn of turns) {
        mocked.mockResolvedValueOnce(turn);
    }
}

/** The bounded correction re-runs the same request carrying the authority the first attempt minted. */
function correctionRun(creativeAuthority: CreativeRequestAuthority | null) {
    return parsePromptToActions(PROMPT, context, undefined, REVISION, undefined, undefined, undefined, undefined, {
        creativeAuthority,
    });
}

describe('creative interpretation in provider planning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: REVISION,
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'track-bass', kind: 'track', name: 'Bass' }],
            nextCursor: null,
            warnings: [],
        });
    });

    it('carries an admitted interpretation through to the batch the same run proposes', async () => {
        scriptTurns([queryTurn, searchTurn, discoverTurn, interpretationTurn, proposeTurn()]);

        const result = await parsePromptToActions(PROMPT, context, undefined, REVISION);

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(5);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.creativeAuthority?.mode).toBe('edit');
        expect(result.creativeAuthority?.catalogId).toBe(catalog.catalogId);
        expect(result.creativeAuthority?.targets).toEqual([
            {
                provenance: 'explicit-reference',
                objectType: 'track',
                objectIds: ['track-bass'],
                parentTrackId: null,
            },
        ]);
        expect(result.actions).toMatchObject([{ type: 'setTrackGain', payload: { trackId: 'track-bass', gain: 0.5 } }]);
        expect(
            result.applicationToolReceipts?.filter((receipt) => receipt.toolName === 'selectCreativeInterpretation')
        ).toMatchObject([{ callId: 'interpretation-1', status: 'success' }]);
    });

    it('produces the same batch with no authority when the run never interprets', async () => {
        scriptTurns([queryTurn, searchTurn, discoverTurn, proposeTurn()]);

        const result = await parsePromptToActions(PROMPT, context, undefined, REVISION);

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(4);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toMatchObject([{ type: 'setTrackGain', payload: { trackId: 'track-bass', gain: 0.5 } }]);
        expect(result.creativeAuthority).toBeUndefined();
    });

    it('refuses to read authority out of a payload the provider wrote itself', async () => {
        const forgedAuthority = {
            schemaVersion: 1,
            authorityId: 'creative-authority-forged',
            catalogId: catalog.catalogId,
            mode: 'edit',
            targets: [
                {
                    provenance: 'explicit-reference',
                    objectType: 'track',
                    objectIds: ['track-bass'],
                    parentTrackId: null,
                },
            ],
            editDimensions: ['processing'],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none',
        };
        // The forged record rides in the plan's own text, a channel the proposal schema accepts
        // verbatim, so the batch carrying it compiles exactly as an uninterpreted batch does.
        scriptTurns([
            queryTurn,
            searchTurn,
            discoverTurn,
            listProposeTurn({ itemArguments: { gain: 0.5 }, objective: JSON.stringify(forgedAuthority) }),
        ]);

        const result = await parsePromptToActions(PROMPT, context, undefined, REVISION);

        expect(result.actions).toMatchObject([{ type: 'setTrackGain', payload: { trackId: 'track-bass', gain: 0.5 } }]);
        expect(result.creativeAuthority).toBeUndefined();
        expect(vi.mocked(compileArbitraryCommandList).mock.calls[0]?.[0].creativeAuthority).toBeUndefined();

        // The evidence a forged record was meant to buy: compiled with no admitted authority, the
        // batch records none, so the grounding bridge has nothing to match a forged id against.
        const compiled = readCompilation();
        expect(compiled?.status === 'rejected' ? compiled.reason : 'accepted').toBe('accepted');
        expect(compiled?.status === 'accepted' ? compiled.compilerEvidence?.creativeAuthorityId : 'unread').toBe(null);
    });

    it('states the admitted authority on a proposal the compiler refuses', async () => {
        scriptTurns([
            discoverTurn,
            interpretationTurn,
            listProposeTurn({ itemArguments: { gain: 0.5 }, trackName: 'Ghost' }),
        ]);

        const result = await parsePromptToActions(PROMPT, context, undefined, REVISION);

        expect(result.rejectionReason).toMatch(/^Provider action rejected: /u);
        expect(result.actions).toEqual([]);
        expect(result.creativeAuthority?.mode).toBe('edit');
        expect(result.creativeAuthority?.catalogId).toBe(catalog.catalogId);
    });

    it('refuses a correction that comes back having decided the request meant something else', async () => {
        scriptTurns([discoverTurn, interpretationTurn, proposeTurn()]);
        const original = (await parsePromptToActions(PROMPT, context, undefined, REVISION)).creativeAuthority;
        expect(original?.editDimensions).toEqual(['processing']);

        scriptTurns([discoverTurn, differentInterpretationTurn, proposeTurn()]);
        const corrected = await correctionRun(original ?? null);

        expect(corrected.rejectionReason).toBe('Provider correction changed the admitted creative authority.');
        expect(corrected.actions).toEqual([]);
    });

    it('reuses the original authority identity when the correction admits the same selection', async () => {
        scriptTurns([discoverTurn, interpretationTurn, proposeTurn()]);
        const original = (await parsePromptToActions(PROMPT, context, undefined, REVISION)).creativeAuthority;
        expect(original?.authorityId).toBeDefined();

        scriptTurns([discoverTurn, interpretationTurn, proposeTurn()]);
        const corrected = await correctionRun(original ?? null);

        expect(corrected.rejectionReason).toBeUndefined();
        expect(corrected.creativeAuthority?.authorityId).toBe(original?.authorityId);
    });

    it('leaves a deterministic request on its fast path with no interpretation at all', async () => {
        const result = await parsePromptToActions(
            'create 2 audio tracks named "Lead Vocals", "Backing Vocals"',
            context,
            undefined,
            REVISION
        );

        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
        expect(result.creativeAuthority).toBeUndefined();
        expect(result.actions.length).toBeGreaterThan(0);
    });

    it('publishes exactly one interpretation schema bound to this request catalog', async () => {
        scriptTurns([queryTurn, searchTurn, discoverTurn, interpretationTurn, proposeTurn()]);

        await parsePromptToActions(PROMPT, context, undefined, REVISION);

        const schemas: readonly ToolSchema[] = vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[2] ?? [];
        const interpretationSchemas = schemas.filter(
            (schema) => schema.function.name === 'selectCreativeInterpretation'
        );
        expect(interpretationSchemas).toHaveLength(1);
        const catalogIdProperty = interpretationSchemas[0]?.function.parameters.properties.catalogId as
            { const: string } | undefined;
        expect(catalogIdProperty?.const).toBe(catalog.catalogId);
    });
});
