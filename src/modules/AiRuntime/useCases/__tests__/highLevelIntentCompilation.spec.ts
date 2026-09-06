import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandTrackDefaultsPort, parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { ADD_NOTES_MAX_NOTES_PER_COMMAND } from '#/utils/midiNoteBatchLimits';

import { type ProjectContext } from '../../models/ProjectContext';
import {
    SEMANTIC_COMMAND_LIST_MAX_COMMANDS,
    SEMANTIC_COMMAND_LIST_MAX_CREATIONS,
    SEMANTIC_COMMAND_LIST_MAX_ITEMS,
    SEMANTIC_COMMAND_LIST_MAX_REPEAT,
} from '../../models/SemanticCommandList';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { buildLlmActionSystemPrompt } from '../../transformers/llmActionBridge';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome),
    };
});

const emptyProject: ProjectContext = {
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
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const selectedClipProject: ProjectContext = {
    ...emptyProject,
    loopEnd: 16,
    selectedTrackId: 'track-bass',
    selectedClipId: 'clip-bass',
    selectedClipIds: ['clip-bass'],
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
            clipCount: 1,
            deviceCount: 0,
            clips: [
                {
                    id: 'clip-bass',
                    name: 'Bass Verse',
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 8,
                    noteCount: 0,
                },
            ],
            devices: [],
            sends: [],
        },
    ],
};

/**
 * Names no track, no clip and no beat: every object the batch creates is one the plan invents. That
 * is exactly what the plan-created object evidence route exists to admit.
 */
const CREATIVE_REQUEST = 'create a blues song with a twelve bar progression';

/** The same request stating the one value that carries project-wide authority. */
const CREATIVE_REQUEST_WITH_TEMPO = 'create a blues song with a twelve bar progression, set tempo to 96 bpm';

const GENERATED_TRACK_ID = /^track-ai-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;
const GENERATED_CLIP_ID = /^clip-ai-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const plan = {
    semantic: { classification: 'complex', uncertainty: [] },
    objective: 'Lay out a twelve-bar blues comp on a new MIDI track.',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
};

const searchTurn = {
    status: 'complete' as const,
    toolCalls: [
        { id: 'search-tracks', name: 'agent.command-index.search', arguments: { intent: 'create a midi track' } },
        { id: 'search-notes', name: 'agent.command-index.search', arguments: { intent: 'write midi notes' } },
    ],
};

const discoverTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'discover-1',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['addTrack', 'addClip', 'addNotes'] },
        },
    ],
};

const discoverTempoTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'discover-1',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['addTrack', 'addClip', 'addNotes', 'setTempo'] },
        },
    ],
};

const namedTracksSearchTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'search-tracks',
            name: 'agent.command-index.search',
            arguments: { intent: 'create two named audio tracks' },
        },
    ],
};

const namedTracksDiscoverTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'discover-tracks',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['addTrack'] },
        },
    ],
};

const renameSearchTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'search-rename',
            name: 'agent.command-index.search',
            arguments: { intent: 'rename the selected clip' },
        },
    ],
};

const renameDiscoverTurn = {
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'discover-rename',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['renameClip'] },
        },
    ],
};

const proposeTurn = (items: ReadonlyArray<Record<string, unknown>>) => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'propose-1',
            name: 'command.batch.propose',
            arguments: { plan, list: { schemaVersion: 1, items } },
        },
    ],
});

const proposeCommandsTurn = (commands: ReadonlyArray<Record<string, unknown>>) => ({
    status: 'complete' as const,
    toolCalls: [
        {
            id: 'propose-commands',
            name: 'command.batch.propose',
            arguments: {
                commands,
                plan: {
                    ...plan,
                    semantic: { classification: 'simple' as const, uncertainty: [] },
                    objective: 'Execute the grounded command batch.',
                    capabilityIds: commands.map((command) => String(command.name)),
                    validationStrategy: ['Validate the grounded command batch.'],
                    stoppingConditions: ['Stop if application validation fails.'],
                },
            },
        },
    ],
});

const declineTurn = (args: Record<string, unknown>) => ({
    status: 'complete' as const,
    toolCalls: [{ id: 'decline-1', name: 'command.batch.decline', arguments: args }],
});

const bluesItems = [
    { id: 'make-track', name: 'addTrack', arguments: { name: 'Blues Comp', kind: 'midi', binding: 'comp' } },
    {
        id: 'make-clip',
        name: 'addClip',
        arguments: { trackId: '$comp', startBeat: 0, endBeat: 12, name: 'Twelve Bar', binding: 'chorus' },
        dependsOn: ['make-track'],
    },
    {
        id: 'write-notes',
        name: 'addNotes',
        arguments: {
            clipId: '$chorus',
            notes: [
                { pitch: 60, startBeat: 0, duration: 1, velocity: 96 },
                { pitch: 64, startBeat: 0, duration: 1, velocity: 96 },
                { pitch: 67, startBeat: 0, duration: 1, velocity: 96 },
            ],
        },
        dependsOn: ['make-clip'],
    },
];

const namedTrackItems = [
    {
        id: 'make-lead-vocals',
        name: 'addTrack',
        arguments: { name: 'Lead Vocals', kind: 'audio', binding: 'lead-vocals' },
    },
    {
        id: 'make-backing-vocals',
        name: 'addTrack',
        arguments: { name: 'Backing Vocals', kind: 'audio', binding: 'backing-vocals' },
    },
];

const renameClipItems = [
    {
        name: 'renameClip',
        arguments: { clipId: 'clip-bass', name: 'Bridge Solo' },
    },
];

describe('high-level intent compilation', () => {
    beforeEach(() => {
        vi.mocked(generateToolPlanningOutcome).mockReset();
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        vi.restoreAllMocks();
    });

    it('semantically preserves unquoted multiword track names through canonical command compilation', async () => {
        const prompt = 'create 2 audio tracks named Lead Vocals, Backing Vocals';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(namedTracksSearchTurn)
            .mockResolvedValueOnce(namedTracksDiscoverTurn)
            .mockResolvedValueOnce(proposeTurn(namedTrackItems));

        const result = await parsePromptToActions(prompt, emptyProject, undefined, 'revision-named-tracks');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[4]).toBe(prompt);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.planningOutcome).toEqual({ kind: 'proposal' });
        expect(result.actions).toMatchObject([
            { type: 'addTrack', payload: { name: 'Lead Vocals', kind: 'audio' } },
            { type: 'addTrack', payload: { name: 'Backing Vocals', kind: 'audio' } },
        ]);

        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        registerHandlerMap(getArrangementHandlers());
        const compiled = compilePlannedActionCommandBatch({
            actions: result.actions,
            actionLabels: result.actions.map((action) => action.type),
            autoCommit: false,
            context: emptyProject,
            group: { groupId: 'named-tracks', groupLabel: 'Named tracks' },
            intent: prompt,
            projectRevision: 'revision-named-tracks',
            runId: 'run-named-tracks',
        });
        const parsed = compiled.commandEnvelopes.map((serialized) => parseVersionedCommandEnvelope(serialized));

        expect(parsed).toEqual([
            expect.objectContaining({
                status: 'valid',
                envelope: expect.objectContaining({
                    operation: 'addTrack',
                    normalizedProjectRevision: 'revision-named-tracks',
                    arguments: expect.objectContaining({ name: 'Lead Vocals', kind: 'audio' }),
                }),
            }),
            expect.objectContaining({
                status: 'valid',
                envelope: expect.objectContaining({
                    operation: 'addTrack',
                    normalizedProjectRevision: 'revision-named-tracks',
                    arguments: expect.objectContaining({ name: 'Backing Vocals', kind: 'audio' }),
                }),
            }),
        ]);
    });

    it('semantically preserves an unquoted multiword clip name through canonical command compilation', async () => {
        const prompt = 'rename clip to Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeCommandsTurn(renameClipItems));

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-rename');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[4]).toBe(prompt);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.planningOutcome).toEqual({ kind: 'proposal' });
        expect(result.actions).toMatchObject([
            { type: 'renameClip', payload: { clipId: 'clip-bass', name: 'Bridge Solo' } },
        ]);

        registerHandlerMap(getArrangementHandlers());
        const compiled = compilePlannedActionCommandBatch({
            actions: result.actions,
            actionLabels: result.actions.map((action) => action.type),
            autoCommit: false,
            context: selectedClipProject,
            group: { groupId: 'rename-clip', groupLabel: 'Rename clip' },
            intent: prompt,
            projectRevision: 'revision-rename',
            runId: 'run-rename',
        });
        const parsed = compiled.commandEnvelopes.map((serialized) => parseVersionedCommandEnvelope(serialized));

        expect(parsed).toEqual([
            expect.objectContaining({
                status: 'valid',
                envelope: expect.objectContaining({
                    operation: 'renameClip',
                    normalizedProjectRevision: 'revision-rename',
                    arguments: expect.objectContaining({ clipId: 'clip-bass', name: 'Bridge Solo' }),
                }),
            }),
        ]);
    });

    it('compiles a track, clip and notes request on an empty project into one batch of canonical commands', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(searchTurn)
            .mockResolvedValueOnce(discoverTurn)
            .mockResolvedValueOnce(proposeTurn(bluesItems));

        const result = await parsePromptToActions(CREATIVE_REQUEST, emptyProject, undefined, 'revision-blues');

        expect(result.rejectionReason).toBeUndefined();
        expect(result.planningOutcome).toEqual({ kind: 'proposal' });
        expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes']);
    });

    it('admits a project-wide tempo only when the request states it', async () => {
        const withTempo = [...bluesItems, { id: 'set-tempo', name: 'setTempo', arguments: { bpm: 96 } }];
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(searchTurn)
            .mockResolvedValueOnce(discoverTempoTurn)
            .mockResolvedValueOnce(proposeTurn(withTempo));

        const stated = await parsePromptToActions(
            CREATIVE_REQUEST_WITH_TEMPO,
            emptyProject,
            undefined,
            'revision-blues'
        );

        expect(stated.rejectionReason).toBeUndefined();
        expect(stated.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes', 'setTempo']);
    });

    it('refuses a project-wide tempo the request never states, while the created objects still compile', async () => {
        const withTempo = [...bluesItems, { id: 'set-tempo', name: 'setTempo', arguments: { bpm: 96 } }];
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(searchTurn)
            .mockResolvedValueOnce(discoverTempoTurn)
            .mockResolvedValueOnce(proposeTurn(withTempo));

        const result = await parsePromptToActions(CREATIVE_REQUEST, emptyProject, undefined, 'revision-blues');

        // The waiver covers objects this batch creates; the tempo of the project is not one of them.
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('setTempo');
    });

    it('mints application-owned identities and points the notes at the clip the same batch created', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(searchTurn)
            .mockResolvedValueOnce(discoverTurn)
            .mockResolvedValueOnce(proposeTurn(bluesItems));

        const { actions } = await parsePromptToActions(CREATIVE_REQUEST, emptyProject, undefined, 'revision-blues');

        const [addTrack, addClip, addNotes] = actions;
        expect(addTrack).toMatchObject({
            type: 'addTrack',
            payload: { id: expect.stringMatching(GENERATED_TRACK_ID) },
        });
        expect(addClip).toMatchObject({ type: 'addClip', payload: { id: expect.stringMatching(GENERATED_CLIP_ID) } });
        // The provider never names an id: the clip the notes land on is the one this batch minted.
        const mintedClipId =
            addClip?.type === 'addClip' && 'id' in addClip.payload ? addClip.payload.id : 'no-minted-clip';
        const mintedTrackId =
            addTrack?.type === 'addTrack' && 'id' in addTrack.payload ? addTrack.payload.id : 'no-minted-track';
        expect(addClip).toMatchObject({ payload: { trackId: mintedTrackId } });
        expect(addNotes).toMatchObject({
            type: 'addNotes',
            payload: {
                clipId: mintedClipId,
                notes: [
                    { pitch: 60, startBeat: 0, duration: 1, velocity: 96 },
                    { pitch: 64, startBeat: 0, duration: 1, velocity: 96 },
                    { pitch: 67, startBeat: 0, duration: 1, velocity: 96 },
                ],
            },
        });
    });

    it('keeps the provider tool surface compact and discloses addNotes only as a discovery receipt', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(searchTurn)
            .mockResolvedValueOnce(discoverTurn)
            .mockResolvedValueOnce(proposeTurn(bluesItems));

        await parsePromptToActions(CREATIVE_REQUEST, emptyProject, undefined, 'revision-blues');

        const turnSchemaNames = (turn: number) =>
            (vi.mocked(generateToolPlanningOutcome).mock.calls[turn]?.[2] ?? []).map(
                (schema: ToolSchema) => schema.function.name
            );
        // The mutation never becomes a provider tool: it stays a schema the application disclosed.
        expect(turnSchemaNames(0)).toContain('agent.command-index.search');
        expect(turnSchemaNames(0)).not.toContain('addNotes');
        expect(turnSchemaNames(2)).not.toContain('addNotes');
        const proposalTurnMessage = vi.mocked(generateToolPlanningOutcome).mock.calls[2]?.[1] ?? '';
        expect(proposalTurnMessage).toContain('discover-1');
        expect(proposalTurnMessage).toContain('addNotes');
    });

    it('states the compile protocol and the live budgets in the planning system prompt', () => {
        const systemPrompt = buildLlmActionSystemPrompt();

        expect(systemPrompt).toContain('agent.command-index.search');
        expect(systemPrompt).toContain('agent.catalog.discover');
        expect(systemPrompt).toContain('exactly one command.batch.propose');
        expect(systemPrompt).toContain(
            `at most ${String(SEMANTIC_COMMAND_LIST_MAX_ITEMS)} list items, ${String(SEMANTIC_COMMAND_LIST_MAX_COMMANDS)} expanded commands, a repeat count of ${String(SEMANTIC_COMMAND_LIST_MAX_REPEAT)}, ${String(SEMANTIC_COMMAND_LIST_MAX_CREATIONS)} created project objects, and ${String(ADD_NOTES_MAX_NOTES_PER_COMMAND)} notes in one addNotes`
        );
        expect(systemPrompt).toContain('command.batch.decline');
    });

    it('reports an ambiguous request as a clarify outcome carrying the provider questions', async () => {
        vi.mocked(generateToolPlanningOutcome).mockResolvedValueOnce(
            declineTurn({
                kind: 'clarify',
                reason: 'The key and the tempo of the blues are not stated.',
                questions: ['Which key should the blues be in?', 'What tempo do you want?'],
            })
        );

        const result = await parsePromptToActions(CREATIVE_REQUEST, emptyProject, undefined, 'revision-blues');

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.planningOutcome).toEqual({
            kind: 'clarify',
            reason: 'The key and the tempo of the blues are not stated.',
            questions: ['Which key should the blues be in?', 'What tempo do you want?'],
        });
    });

    it('reports a searched-for capability the catalog lacks as an unsupported outcome', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'search-mastering',
                        name: 'agent.command-index.search',
                        arguments: { intent: 'master the song for vinyl' },
                    },
                ],
            })
            .mockResolvedValueOnce(
                declineTurn({
                    kind: 'unsupported',
                    reason: 'No command in this project masters for vinyl.',
                    questions: [],
                })
            );

        const result = await parsePromptToActions('master this for vinyl', emptyProject, undefined, 'revision-blues');

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.planningOutcome).toEqual({
            kind: 'unsupported',
            reason: 'No command in this project masters for vinyl.',
            searchedIntents: ['master the song for vinyl'],
        });
    });
});
