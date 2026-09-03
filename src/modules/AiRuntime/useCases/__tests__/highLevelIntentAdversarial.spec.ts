import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADD_NOTES_MAX_NOTES_PER_COMMAND } from '#/utils/midiNoteBatchLimits';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { SEMANTIC_CLIP_MAX_BEATS, SEMANTIC_COMMAND_LIST_MAX_CREATIONS } from '../../models/SemanticCommandList';
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

/** Names every created object and every beat, so only the attack under test can reject the batch. */
const LITERAL_PROMPT =
    'add a midi track named Blues Comp and add a midi clip named Twelve Bar on the Blues Comp track from beat 0 to beat 12 and add notes to the Twelve Bar clip';

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

const searchTurn = {
    status: 'complete' as const,
    toolCalls: [{ id: 'search-1', name: 'agent.command-index.search', arguments: { intent: 'create a midi track' } }],
};

const proposeCall = (items: ReadonlyArray<Record<string, unknown>>) => ({
    id: 'propose-1',
    name: 'command.batch.propose',
    arguments: { plan, list: { schemaVersion: 1, items } },
});

const declineCall = (args: Record<string, unknown>) => ({
    id: 'decline-1',
    name: 'command.batch.decline',
    arguments: args,
});

const makeTrack = {
    id: 'make-track',
    name: 'addTrack',
    arguments: { name: 'Blues Comp', kind: 'midi', binding: 'comp' },
};
const makeClip = {
    id: 'make-clip',
    name: 'addClip',
    arguments: { trackId: '$comp', startBeat: 0, endBeat: 12, name: 'Twelve Bar', binding: 'chorus' },
    dependsOn: ['make-track'],
};

const note = (index: number) => ({ pitch: 60, startBeat: index, duration: 1, velocity: 96 });

async function planWith(
    turns: ReadonlyArray<{ status: 'complete'; toolCalls: unknown[] }>,
    prompt = LITERAL_PROMPT,
    context: ProjectContext = emptyProject
) {
    const mocked = vi.mocked(generateToolPlanningOutcome);
    for (const turn of turns) {
        mocked.mockResolvedValueOnce(turn);
    }
    return parsePromptToActions(prompt, context, undefined, 'revision-adversarial');
}

const track = (id: string, name: string): ProjectContextTrack => ({
    id,
    name,
    kind: 'midi',
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
});

/** Invents every object it asks for, which is what opens the plan-created object route. */
const CREATIVE_PROMPT = 'create a blues song with a twelve bar progression';

const makeNotes = {
    id: 'write-notes',
    name: 'addNotes',
    arguments: { clipId: '$chorus', notes: [note(0)] },
    dependsOn: ['make-clip'],
};

const proposalRun = (items: ReadonlyArray<Record<string, unknown>>) => [
    discoverTurn,
    { status: 'complete' as const, toolCalls: [proposeCall(items)] },
];

const proposalRunFor = (names: readonly string[], items: ReadonlyArray<Record<string, unknown>>) => [
    {
        status: 'complete' as const,
        toolCalls: [{ id: 'discover-1', name: 'agent.catalog.discover', arguments: { category: 'command', names } }],
    },
    { status: 'complete' as const, toolCalls: [proposeCall(items)] },
];

describe('high-level intent adversarial planning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('(a) refuses an addNotes command carrying more notes than one command may hold', async () => {
        const result = await planWith(
            proposalRun([
                makeTrack,
                makeClip,
                {
                    id: 'write-notes',
                    name: 'addNotes',
                    arguments: {
                        clipId: '$chorus',
                        notes: Array.from({ length: ADD_NOTES_MAX_NOTES_PER_COMMAND + 1 }, (_unused, index) =>
                            note(index)
                        ),
                    },
                    dependsOn: ['make-clip'],
                },
            ])
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain(
            `Expected one existing unlocked MIDI clip on an unfrozen track and 1 to ${String(ADD_NOTES_MAX_NOTES_PER_COMMAND)} well-formed notes`
        );
    });

    it('(b) refuses an addNotes command aimed at a clip id the project does not hold', async () => {
        const result = await planWith(
            proposalRun([
                {
                    id: 'write-notes',
                    name: 'addNotes',
                    arguments: { clipId: 'clip-999', notes: [note(0)] },
                },
            ])
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'Provider action rejected: Targeted command requires a bounded semantic bulk selector.'
        );
    });

    it('(c) refuses a clip bound to a producer that creates an audio track', async () => {
        const result = await planWith(
            proposalRun([
                {
                    id: 'make-track',
                    name: 'addTrack',
                    arguments: { name: 'Blues Comp', kind: 'audio', binding: 'comp' },
                },
                {
                    id: 'make-clip',
                    name: 'addClip',
                    arguments: { trackId: '$comp', startBeat: 0, endBeat: 12, name: 'Twelve Bar', binding: 'chorus' },
                    dependsOn: ['make-track'],
                },
                {
                    id: 'write-notes',
                    name: 'addNotes',
                    arguments: { clipId: '$chorus', notes: [note(0)] },
                    dependsOn: ['make-clip'],
                },
            ])
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'Provider action rejected: Batch-local binding producer does not create a typed object: chorus'
        );
    });

    it('(d) refuses a batch-local reference that does not declare its producer as a dependency', async () => {
        const result = await planWith(
            proposalRun([
                makeTrack,
                {
                    id: 'make-clip',
                    name: 'addClip',
                    arguments: { trackId: '$comp', startBeat: 0, endBeat: 12, name: 'Twelve Bar', binding: 'chorus' },
                },
            ])
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'Provider action rejected: Batch-local target $comp requires an earlier bounded producer dependency.'
        );
    });

    it('(e) refuses an unsupported decline from a provider that never searched the command index', async () => {
        const result = await planWith([
            {
                status: 'complete',
                toolCalls: [
                    declineCall({ kind: 'unsupported', reason: 'Sourdaw cannot master for vinyl.', questions: [] }),
                ],
            },
        ]);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe('Provider declined as unsupported without searching the command index.');
        expect(result.planningOutcome).toEqual({
            kind: 'denied',
            reason: 'Provider declined as unsupported without searching the command index.',
        });
    });

    it('(f) refuses a clarify decline that asks nothing', async () => {
        const result = await planWith([
            {
                status: 'complete',
                toolCalls: [declineCall({ kind: 'clarify', reason: 'The request is ambiguous.', questions: [] })],
            },
        ]);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe('Provider asked for clarification without a question.');
        expect(result.planningOutcome).toEqual({
            kind: 'denied',
            reason: 'Provider asked for clarification without a question.',
        });
    });

    it('(g) refuses a plan that creates more project objects than the creation budget allows', async () => {
        const items = Array.from({ length: SEMANTIC_COMMAND_LIST_MAX_CREATIONS + 1 }, (_unused, index) => ({
            id: `make-track-${String(index)}`,
            name: 'addTrack',
            arguments: { name: `Blues Comp ${String(index)}`, kind: 'midi', binding: `comp${String(index)}` },
        }));

        const result = await planWith(proposalRun(items));

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            `Provider action rejected: Semantic command list creates more than ${String(SEMANTIC_COMMAND_LIST_MAX_CREATIONS)} project objects`
        );
    });

    it('(h) refuses a turn that declines and proposes at once', async () => {
        const result = await planWith([
            discoverTurn,
            {
                status: 'complete',
                toolCalls: [
                    declineCall({ kind: 'clarify', reason: 'Which key?', questions: ['Which key?'] }),
                    proposeCall([makeTrack]),
                ],
            },
        ]);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'Provider planning rejected: Provider combined a decline with another terminal call.'
        );
    });

    it('(i) refuses a decline carrying an argument the catalog contract does not define', async () => {
        const result = await planWith([
            {
                status: 'complete',
                toolCalls: [
                    declineCall({
                        kind: 'clarify',
                        reason: 'Which key?',
                        questions: ['Which key?'],
                        commands: [{ name: 'addTrack', arguments: { name: 'Sneaky', kind: 'midi' } }],
                    }),
                ],
            },
        ]);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'Provider planning rejected: Provider decline carries an argument outside the catalog contract.'
        );
    });

    it('(j) refuses an addNotes command carrying a note outside the MIDI pitch range', async () => {
        const result = await planWith(
            proposalRun([
                makeTrack,
                makeClip,
                {
                    id: 'write-notes',
                    name: 'addNotes',
                    arguments: { clipId: '$chorus', notes: [{ pitch: 128, startBeat: 0, duration: 1, velocity: 96 }] },
                    dependsOn: ['make-clip'],
                },
            ])
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain(
            `Expected one existing unlocked MIDI clip on an unfrozen track and 1 to ${String(ADD_NOTES_MAX_NOTES_PER_COMMAND)} well-formed notes`
        );
    });

    it('(k) refuses a creation batch under a request that asks to create nothing', async () => {
        const result = await planWith(proposalRun([makeTrack, makeClip, makeNotes]), 'mute the vocals');

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('Provider action is not grounded in the user request');
    });

    it('(l) refuses a creative batch that names an existing track id outright', async () => {
        const result = await planWith(
            proposalRun([
                makeTrack,
                {
                    id: 'make-clip',
                    name: 'addClip',
                    arguments: {
                        trackId: 'track-existing',
                        startBeat: 0,
                        endBeat: 12,
                        name: 'Twelve Bar',
                        binding: 'chorus',
                    },
                    dependsOn: ['make-track'],
                },
            ]),
            CREATIVE_PROMPT,
            { ...emptyProject, tracks: [track('track-existing', 'Vocals')] }
        );

        // The waiver never sees this batch: a raw project id is not a semantic target at all, so the
        // list refuses it a layer earlier than grounding. Reaching an existing object takes a selector.
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('Targeted command requires a bounded semantic bulk selector');
    });

    it('(m) refuses an unsafe provider name on a plan-created object', async () => {
        const bound = await planWith(
            proposalRun([
                {
                    id: 'make-track',
                    name: 'addTrack',
                    arguments: { name: 'Blues <Comp>', kind: 'midi', binding: 'comp' },
                },
            ]),
            CREATIVE_PROMPT
        );

        expect(bound.actions).toEqual([]);
        expect(bound.rejectionReason).toContain('A bound creation requires one safe name');

        vi.clearAllMocks();

        // The waiver drops the ordinary name value rule, so the route owes its own check: a rename of
        // a plan-created track is where an unsafe name would otherwise reach the project unexamined.
        const renamed = await planWith(
            proposalRunFor(
                ['addTrack', 'renameTrack'],
                [
                    makeTrack,
                    {
                        id: 'rename',
                        name: 'renameTrack',
                        arguments: { trackId: '$comp', name: 'Blues <Comp>' },
                        dependsOn: ['make-track'],
                    },
                ]
            ),
            CREATIVE_PROMPT
        );

        expect(renamed.actions).toEqual([]);
        expect(renamed.rejectionReason).toContain('Plan-created object name is not a safe project name');
    });

    it('(n) reads creation evidence from the request alone, never from a track named like one', async () => {
        const result = await planWith(proposalRun([makeTrack, makeClip, makeNotes]), 'mute the vocals', {
            ...emptyProject,
            tracks: [track('track-injected', 'create a blues song with drums')],
        });

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('Provider action is not grounded in the user request');
    });

    it('(o) refuses a plan-created clip longer than the batch clip span budget', async () => {
        const result = await planWith(
            proposalRun([
                makeTrack,
                {
                    id: 'make-clip',
                    name: 'addClip',
                    arguments: {
                        trackId: '$comp',
                        startBeat: 0,
                        endBeat: SEMANTIC_CLIP_MAX_BEATS + 1,
                        name: 'Twelve Bar',
                        binding: 'chorus',
                    },
                    dependsOn: ['make-track'],
                },
            ]),
            CREATIVE_PROMPT
        );

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain(
            `Plan-created clip exceeds the batch clip span budget of ${String(SEMANTIC_CLIP_MAX_BEATS)} beats`
        );
    });

    it('admits a decline only after the command-index search that justifies it', async () => {
        const result = await planWith([
            searchTurn,
            {
                status: 'complete',
                toolCalls: [
                    declineCall({ kind: 'unsupported', reason: 'Sourdaw cannot master for vinyl.', questions: [] }),
                ],
            },
        ]);

        expect(result.rejectionReason).toBeUndefined();
        expect(result.planningOutcome).toEqual({
            kind: 'unsupported',
            reason: 'Sourdaw cannot master for vinyl.',
        });
    });
});
