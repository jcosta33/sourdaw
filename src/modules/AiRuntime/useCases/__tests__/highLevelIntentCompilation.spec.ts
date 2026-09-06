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
            clipCount: 2,
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
                {
                    id: 'clip-lead',
                    name: 'Lead',
                    type: 'audio',
                    startBeat: 8,
                    endBeat: 16,
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

const renameLeadClipItems = [
    {
        id: 'rename-lead',
        name: 'renameClip',
        arguments: { name: 'Bridge Solo' },
        selector: {
            targetArgument: 'clipId',
            entity: 'clip',
            where: { name: 'Lead' },
            quantity: { unit: 'targets', exactly: 1 },
        },
    },
];

function renameClipListItem(selectorName: string, name = 'Bridge Solo') {
    return {
        id: `rename-${selectorName.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`,
        name: 'renameClip',
        arguments: { name },
        selector: {
            targetArgument: 'clipId',
            entity: 'clip' as const,
            where: { name: selectorName },
            quantity: { unit: 'targets' as const, exactly: 1 },
        },
    };
}

function withLiteralSelectedClip(context: ProjectContext): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.map((track) => ({
            ...track,
            clipCount: track.clipCount + 1,
            clips: [
                ...track.clips,
                {
                    id: 'clip-literal-selected',
                    name: 'Selected Clip',
                    type: 'audio' as const,
                    startBeat: 16,
                    endBeat: 24,
                    noteCount: 0,
                },
            ],
        })),
    };
}

function withCurlyApostropheClip(context: ProjectContext): ProjectContext {
    const track = context.tracks[0]!;
    return {
        ...context,
        tracks: [
            {
                ...track,
                clipCount: track.clipCount + 1,
                clips: [
                    ...track.clips,
                    {
                        id: 'clip-curly-selected',
                        name: 'Drummer’s Selected Clip',
                        type: 'audio' as const,
                        startBeat: 16,
                        endBeat: 24,
                        noteCount: 0,
                    },
                ],
            },
        ],
    };
}

describe('high-level intent compilation', () => {
    beforeEach(() => {
        vi.mocked(generateToolPlanningOutcome)
            .mockReset()
            .mockResolvedValue(
                declineTurn({
                    kind: 'clarify',
                    reason: 'The scripted provider has no additional proposal turn.',
                    questions: ['What should happen next?'],
                })
            );
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

    it('keeps an explicit clip source ahead of the selected clip through real routing', async () => {
        const prompt = 'rename Lead to Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(
                proposeCommandsTurn([{ name: 'renameClip', arguments: { clipId: 'clip-lead', name: 'Bridge Solo' } }])
            );

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-rename-lead');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[4]).toBe(prompt);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toMatchObject([
            { type: 'renameClip', payload: { clipId: 'clip-lead', name: 'Bridge Solo' } },
        ]);
    });

    it.each([
        {
            label: 'direct',
            proposal: proposeCommandsTurn([
                { name: 'renameClip', arguments: { clipId: 'clip-lead', name: 'Bridge Solo' } },
            ]),
        },
        { label: 'compiler-backed', proposal: proposeTurn([renameClipListItem('Lead')]) },
    ])('keeps an explicit source independent of multi-selection for a $label proposal', async ({ proposal }) => {
        const prompt = 'rename Lead to Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposal);

        const result = await parsePromptToActions(
            prompt,
            { ...selectedClipProject, selectedClipIds: ['clip-bass', 'clip-lead'] },
            undefined,
            'revision-explicit-multi-selection'
        );

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([{ type: 'renameClip', payload: { clipId: 'clip-lead', name: 'Bridge Solo' } }]);
    });

    it('uses the optional-to bare rename carrier on the semantic route', async () => {
        const prompt = 'rename clip Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeCommandsTurn(renameClipItems));

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-rename-no-to');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([{ type: 'renameClip', payload: { clipId: 'clip-bass', name: 'Bridge Solo' } }]);
    });

    it.each([
        { label: 'direct', proposal: proposeCommandsTurn(renameClipItems) },
        { label: 'compiler-backed', proposal: proposeTurn([renameClipListItem('Bass Verse')]) },
    ])('rejects an ambiguous bare source on the $label optional-to route', async ({ proposal }) => {
        const prompt = 'rename clip Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposal);

        const result = await parsePromptToActions(
            prompt,
            { ...selectedClipProject, selectedClipIds: ['clip-bass', 'clip-lead'] },
            undefined,
            'revision-rename-no-to-ambiguous'
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('not grounded');
    });

    it.each([
        {
            label: 'direct',
            proposal: proposeCommandsTurn([
                { name: 'renameClip', arguments: { clipId: 'clip-curly-selected', name: 'Bridge Solo' } },
            ]),
        },
        {
            label: 'compiler-backed',
            proposal: proposeTurn([renameClipListItem('Drummer’s Selected Clip')]),
        },
    ])('keeps a curly-apostrophe quoted source literal for a $label proposal', async ({ proposal }) => {
        const prompt = 'rename ‘Drummer’s Selected Clip’ to Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposal);

        const result = await parsePromptToActions(
            prompt,
            withCurlyApostropheClip(selectedClipProject),
            undefined,
            'revision-curly-apostrophe-source'
        );

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([
            { type: 'renameClip', payload: { clipId: 'clip-curly-selected', name: 'Bridge Solo' } },
        ]);
    });

    it('rejects the selected clip for a quoted curly-apostrophe source', async () => {
        const prompt = 'rename ‘Drummer’s Selected Clip’ to Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeCommandsTurn(renameClipItems));

        const result = await parsePromptToActions(
            prompt,
            withCurlyApostropheClip(selectedClipProject),
            undefined,
            'revision-curly-apostrophe-wrong-source'
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('does not match');
    });

    it.each([
        {
            prompt: 'rename Lead to Bridge Solo',
            selectorName: 'Lead',
            expectedClipId: 'clip-lead',
        },
        {
            prompt: 'rename "Lead" to Bridge Solo',
            selectorName: 'Lead',
            expectedClipId: 'clip-lead',
        },
        {
            prompt: 'rename clip to Bridge Solo',
            selectorName: 'Bass Verse',
            expectedClipId: 'clip-bass',
        },
    ])(
        'keeps source authority on a matching compiler selector for $prompt',
        async ({ prompt, selectorName, expectedClipId }) => {
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce(renameSearchTurn)
                .mockResolvedValueOnce(renameDiscoverTurn)
                .mockResolvedValueOnce(proposeTurn([renameClipListItem(selectorName)]));

            const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-rename-list');

            expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
            expect(result.rejectionReason).toBeUndefined();
            expect(result.actions).toEqual([
                { type: 'renameClip', payload: { clipId: expectedClipId, name: 'Bridge Solo' } },
            ]);
            expect(result.providerProposal?.scope.targetIds).toEqual([expectedClipId]);
        }
    );

    it.each([
        {
            prompt: 'rename Lead to Bridge Solo',
            selectorName: 'Bass Verse',
        },
        {
            prompt: 'rename clip to Bridge Solo',
            selectorName: 'Lead',
        },
    ])(
        'rejects a compiler selector that contradicts source authority for $prompt',
        async ({ prompt, selectorName }) => {
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce(renameSearchTurn)
                .mockResolvedValueOnce(renameDiscoverTurn)
                .mockResolvedValueOnce(proposeTurn([renameClipListItem(selectorName)]));

            const result = await parsePromptToActions(
                prompt,
                selectedClipProject,
                undefined,
                'revision-rename-list-wrong'
            );

            expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
            expect(result.actions).toEqual([]);
            expect(result.rejectionReason).toContain('does not match');
        }
    );

    it('preserves source order across multiple ordinary rename commands', async () => {
        const prompt = 'rename Bass Verse to Bridge Solo, then rename Lead to Melody';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(
                proposeCommandsTurn([
                    { name: 'renameClip', arguments: { clipId: 'clip-bass', name: 'Bridge Solo' } },
                    { name: 'renameClip', arguments: { clipId: 'clip-lead', name: 'Melody' } },
                ])
            );

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-rename-sequence');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([
            { type: 'renameClip', payload: { clipId: 'clip-bass', name: 'Bridge Solo' } },
            { type: 'renameClip', payload: { clipId: 'clip-lead', name: 'Melody' } },
        ]);
    });

    it('rejects a provider attempt to replace an explicit clip source with the selection', async () => {
        const prompt = 'rename Lead to Bridge Solo';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeCommandsTurn(renameClipItems));

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-rename-wrong');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('does not match');
    });

    it('rejects a direct rename proposal for a clip protected by the whole request', async () => {
        const prompt = 'rename clip to Bridge Solo; leave Bass Verse unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeCommandsTurn(renameClipItems));

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-protected');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected');
    });

    it('retains an unrelated protected clip in compiler-backed proposal scope', async () => {
        const prompt = 'rename Lead to Bridge Solo; leave Bass Verse unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeTurn(renameLeadClipItems));

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-protected-scope');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toMatchObject([
            { type: 'renameClip', payload: { clipId: 'clip-lead', name: 'Bridge Solo' } },
        ]);
        expect(result.providerProposal?.scope.targetIds).toEqual(['clip-lead']);
        expect(result.providerProposal?.scope.protectedTargetIds).toEqual(expect.arrayContaining(['clip-bass']));
    });

    it('rejects a compiler-backed rename when its resolved target is protected', async () => {
        const prompt = 'rename Lead to Bridge Solo; leave Lead unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeTurn(renameLeadClipItems));

        const result = await parsePromptToActions(prompt, selectedClipProject, undefined, 'revision-protected-list');

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected');
    });

    it('rejects an explicitly named rename target inside a protected clip selection', async () => {
        const prompt = 'rename Lead to Bridge Solo; leave selected clips unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(
                proposeCommandsTurn([{ name: 'renameClip', arguments: { clipId: 'clip-lead', name: 'Bridge Solo' } }])
            );

        const result = await parsePromptToActions(
            prompt,
            { ...selectedClipProject, selectedClipIds: ['clip-bass', 'clip-lead'] },
            undefined,
            'revision-protected-selection'
        );

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected');
    });

    it.each([
        {
            label: 'direct',
            proposal: proposeCommandsTurn([
                { name: 'renameClip', arguments: { clipId: 'clip-bass', name: 'Opening' } },
            ]),
        },
        {
            label: 'compiler-backed',
            proposal: proposeTurn([renameClipListItem('Bass Verse', 'Opening')]),
        },
    ])('rejects a $label rename protected by a combined selected and named list', async ({ proposal }) => {
        const prompt = 'rename Bass Verse to Opening; leave selected clips and Lead unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposal);

        const result = await parsePromptToActions(
            prompt,
            { ...selectedClipProject, selectedClipIds: ['clip-bass'] },
            undefined,
            'revision-combined-protection'
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected');
    });

    it.each([
        'rename Lead to Opening; leave unchanged',
        'rename Lead to Opening; leave Bass Verse, , Lead unchanged',
        'rename Lead to Opening; leave "Bass Verse unchanged',
    ])('rejects malformed protection syntax before admitting %s', async (prompt) => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(
                proposeCommandsTurn([{ name: 'renameClip', arguments: { clipId: 'clip-lead', name: 'Opening' } }])
            );

        const result = await parsePromptToActions(
            prompt,
            selectedClipProject,
            undefined,
            'revision-malformed-protection'
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('incomplete or malformed');
    });

    it('retains every combined protection in accepted compiler scope', async () => {
        const prompt = 'rename Lead to Bridge Solo; leave selected clips and "Selected Clip" unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposeTurn(renameLeadClipItems));

        const result = await parsePromptToActions(
            prompt,
            withLiteralSelectedClip(selectedClipProject),
            undefined,
            'revision-combined-protected-scope'
        );

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([{ type: 'renameClip', payload: { clipId: 'clip-lead', name: 'Bridge Solo' } }]);
        expect(result.providerProposal?.scope.protectedTargetIds).toEqual(
            expect.arrayContaining(['clip-bass', 'clip-literal-selected'])
        );
    });

    it.each([
        {
            label: 'direct',
            proposal: proposeCommandsTurn([
                { name: 'renameClip', arguments: { clipId: 'clip-literal-selected', name: 'Bridge Solo' } },
            ]),
        },
        {
            label: 'compiler-backed',
            proposal: proposeTurn([renameClipListItem('Selected Clip')]),
        },
    ])('rejects a $label rename of a quoted literal protected clip', async ({ proposal }) => {
        const prompt = 'rename clip-literal-selected to Bridge Solo; leave "Selected Clip" unchanged';
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(renameSearchTurn)
            .mockResolvedValueOnce(renameDiscoverTurn)
            .mockResolvedValueOnce(proposal);

        const result = await parsePromptToActions(
            prompt,
            withLiteralSelectedClip(selectedClipProject),
            undefined,
            'revision-protected-literal-selection'
        );

        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected');
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
