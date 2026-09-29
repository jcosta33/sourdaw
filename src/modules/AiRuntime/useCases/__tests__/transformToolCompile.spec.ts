import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { projectAnthropicStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectAnthropicStrictToolSchema';
import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { APPLICATION_OWNED_TOOL_SCHEMAS, runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeTransformCompile } from '../executeTransformCompile';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { projectDeclarativeTransformSnapshot } from '../projectDeclarativeTransformSnapshot';

import { eventEnvelope, finishEnvelope, readyRequest } from './modelProviderProtocolFixture';

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../transformers/promptParser/parsing')>()),
    tryPresetMatch: vi.fn(),
    tryParameterizedPath: vi.fn(),
    tryCompoundFastPath: vi.fn(),
}));

const CONTEXT: ProjectContext = {
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
    tracks: [
        {
            id: 'track-keys',
            name: 'Keys',
            kind: 'midi',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            clipCount: 2,
            deviceCount: 0,
            clips: [
                { id: 'clip-verse', name: 'Verse', type: 'midi', startBeat: 0, endBeat: 8, noteCount: 4 },
                { id: 'clip-chorus', name: 'Chorus', type: 'midi', startBeat: 8, endBeat: 16, noteCount: 4 },
            ],
            devices: [],
        },
    ],
    selectedTrackId: 'track-keys',
    selectedClipId: 'clip-verse',
    selectedClipIds: ['clip-verse', 'clip-chorus'],
    activeView: 'arrange',
    playheadPosition: 0,
};

const DOCUMENT = {
    schemaVersion: 1,
    name: 'set-selected-velocities',
    seed: 7,
    variables: {
        velocity: {
            node: 'add',
            left: { node: 'const', quantity: { unit: 'count', value: 80 } },
            right: { node: 'const', quantity: { unit: 'count', value: 10 } },
        },
    },
    selectors: { clips: { target: 'clip', where: { contentType: 'midi' }, limit: 2 } },
    steps: [
        {
            id: 'each-clip',
            kind: 'each',
            selector: 'clips',
            as: 'clip',
            body: [
                {
                    id: 'inside-bound',
                    kind: 'when',
                    condition: {
                        cmp: 'lt',
                        left: { node: 'index', item: 'clip' },
                        right: { node: 'const', quantity: { unit: 'count', value: 2 } },
                    },
                    then: [
                        {
                            id: 'emit-velocity',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: { clipId: { itemId: 'clip' }, velocity: { node: 'var', name: 'velocity' } },
                        },
                    ],
                },
            ],
        },
    ],
    assertions: [],
};

function planCalls(selected: string[] = ['compile-1'], document: unknown = DOCUMENT) {
    vi.mocked(generateToolPlanningOutcome)
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [
                { id: 'compile-1', name: 'transform.compile', arguments: { document: JSON.stringify(document) } },
            ],
        })
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [
                {
                    id: 'propose-1',
                    name: 'command.batch.propose',
                    arguments: { commands: [], compiledCallIds: selected },
                },
            ],
        });
}

describe('transform.compile planner tool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    });

    it('publishes the application-owned transform compiler to planning providers', () => {
        expect(APPLICATION_OWNED_TOOL_SCHEMAS.map((schema) => schema.function.name)).toContain('transform.compile');
    });

    it('accepts one JSON-text wire document and rejects an object-shaped wire document', () => {
        const snapshot = projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1');
        const compile = (document: unknown) =>
            executeTransformCompile({
                call: { name: 'transform.compile', arguments: { document } },
                callId: 'wire-document',
                turn: 1,
                snapshot,
            });
        expect(compile(JSON.stringify(DOCUMENT)).receipt.status).toBe('success');
        expect(compile(DOCUMENT).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
    });

    it('admits the full nested JSON text through both hosted projections and the ordinary proposal route', async () => {
        const schema = APPLICATION_OWNED_TOOL_SCHEMAS.find((tool) => tool.function.name === 'transform.compile');
        expect(schema).toBeDefined();
        if (!schema) {
            throw new Error('Expected transform.compile in the application-owned catalog');
        }
        const document = {
            ...DOCUMENT,
            assertions: [
                {
                    condition: {
                        cmp: 'lt',
                        left: { node: 'const', quantity: { unit: 'count', value: 0 } },
                        right: { node: 'var', name: 'velocity' },
                    },
                    message: 'Velocity must be positive.',
                },
            ],
        };
        for (const project of [projectAnthropicStrictToolSchema, projectOpenAiStrictToolSchema]) {
            const wire = project(schema);
            const parameters = wire.function.parameters;
            expect(parameters.properties.document).toMatchObject({ type: 'string' });
            const { protocol, request } = readyRequest({
                operation: 'tools',
                tools: [{ name: wire.function.name, description: wire.function.description, parameters }],
            });
            const accepted = protocol.start(request);
            expect(() =>
                accepted.push(
                    eventEnvelope(request, 0, {
                        type: 'tool-call',
                        call: {
                            id: 'compile-text',
                            name: 'transform.compile',
                            arguments: { document: JSON.stringify(document) },
                        },
                    })
                )
            ).not.toThrow();
            const admitted = accepted.finish(finishEnvelope(request, 1, { reason: 'stop' }));
            expect(admitted.output.toolCalls).toHaveLength(1);
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce({ status: 'complete', toolCalls: admitted.output.toolCalls })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'propose-1',
                            name: 'command.batch.propose',
                            arguments: { commands: [], compiledCallIds: ['compile-text'] },
                        },
                    ],
                });
            const planned = await parsePromptToActions(
                'set note velocities in the selected MIDI clips to 90',
                CONTEXT,
                undefined,
                'revision-transform-1'
            );
            expect(planned.rejectionReason).toBeUndefined();
            expect(planned.actions).toHaveLength(2);
            const rejected = protocol.start(request);
            expect(() =>
                rejected.push(
                    eventEnvelope(request, 0, {
                        type: 'tool-call',
                        call: { id: 'compile-object', name: 'transform.compile', arguments: { document } },
                    })
                )
            ).toThrow(/arguments/i);
        }
        expect(
            executeTransformCompile({
                call: { name: 'transform.compile', arguments: { document: JSON.stringify(document) } },
                callId: 'full-document',
                turn: 1,
                snapshot: projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1'),
            }).receipt.status
        ).toBe('success');
        const advertised = schema.function.parameters.properties.document;
        const exampleMarker = 'Valid complete document JSON text: ';
        if (
            typeof advertised !== 'object' ||
            advertised === null ||
            !('description' in advertised) ||
            typeof advertised.description !== 'string'
        ) {
            throw new Error('Expected transform document guidance in the catalog');
        }
        expect(advertised.description).toContain(exampleMarker);
        const exampleText = advertised.description.slice(
            advertised.description.indexOf(exampleMarker) + exampleMarker.length
        );
        expect(
            executeTransformCompile({
                call: { name: 'transform.compile', arguments: { document: exampleText } },
                callId: 'advertised-example',
                turn: 1,
                snapshot: projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1'),
            }).receipt.status
        ).toBe('success');
    });

    it('refuses malformed, duplicate-key, and oversized JSON text before compilation', () => {
        const snapshot = projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1');
        const duplicateName = JSON.stringify(DOCUMENT).replace(
            '"name":"set-selected-velocities"',
            '"name":"wrong","na\\u006de":"set-selected-velocities"'
        );
        for (const source of ['{', duplicateName, ' '.repeat(1_024 * 1_024 + 1)]) {
            const result = executeTransformCompile({
                call: { name: 'transform.compile', arguments: { document: source } },
                callId: 'bad-json',
                turn: 1,
                snapshot,
            });
            expect(result.commands).toBeNull();
            expect(result.receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
        }
    });

    it('returns exact expanded commands in a receipt and carries selected emissions into one approval batch', async () => {
        planCalls();
        const result = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.applicationToolReceipts).toMatchObject([
            {
                callId: 'compile-1',
                toolName: 'transform.compile',
                status: 'success',
                revision: 'revision-transform-1',
            },
        ]);
        expect(result.actions).toEqual([
            { type: 'setAllVelocities', payload: expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }) },
            { type: 'setAllVelocities', payload: expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }) },
        ]);
        expect(result.executionMode).toBe('atomic');
        expect(result.requiresConfirmation).toBe(true);
        expect(result.actionCommandGraph?.dependenciesByActionIndex).toEqual([[], []]);
    });

    it('grounds a named MIDI clip list and the value at the end of its continuation', async () => {
        planCalls();
        const result = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
        ]);
    });

    it('refuses a compiled batch when a later clause edits a clip excluded by the original request', async () => {
        const context = {
            ...CONTEXT,
            tracks: [
                {
                    ...CONTEXT.tracks[0]!,
                    clips: [
                        ...CONTEXT.tracks[0]!.clips,
                        {
                            id: 'clip-bridge',
                            name: 'Bridge',
                            type: 'midi' as const,
                            startBeat: 16,
                            endBeat: 24,
                            noteCount: 4,
                        },
                    ],
                },
            ],
        };
        const document = {
            ...DOCUMENT,
            selectors: {
                verse: { target: 'clip', where: { nameIncludes: 'Verse' }, limit: 1 },
                chorus: { target: 'clip', where: { nameIncludes: 'Chorus' }, limit: 1 },
                bridge: { target: 'clip', where: { nameIncludes: 'Bridge' }, limit: 1 },
            },
            steps: (['verse', 'chorus', 'bridge'] as const).map((selector) => ({
                id: `${selector}-each`,
                kind: 'each',
                selector,
                as: 'clip',
                body: [
                    {
                        id: `${selector}-emit`,
                        kind: 'emit',
                        operation: 'setAllVelocities',
                        arguments: {
                            clipId: { itemId: 'clip' },
                            velocity: { literal: selector === 'bridge' ? 100 : 90 },
                        },
                    },
                ],
            })),
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90, excluding Chorus; set note velocities in Bridge MIDI clip to 100',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected or unresolved target');
    });

    it('keeps a later rename outside the exclusion while admitting both requested edits', async () => {
        const context = {
            ...CONTEXT,
            tracks: [
                {
                    ...CONTEXT.tracks[0]!,
                    clips: [
                        {
                            id: 'clip-bass-verse',
                            name: 'Bass Verse',
                            type: 'midi' as const,
                            startBeat: 0,
                            endBeat: 8,
                            noteCount: 4,
                        },
                        {
                            id: 'clip-lead',
                            name: 'Lead',
                            type: 'midi' as const,
                            startBeat: 8,
                            endBeat: 16,
                            noteCount: 4,
                        },
                    ],
                },
            ],
            selectedClipId: 'clip-bass-verse',
            selectedClipIds: ['clip-bass-verse'],
        };
        const document = {
            ...DOCUMENT,
            selectors: { bass: { target: 'clip', where: { nameIncludes: 'Bass Verse' }, limit: 1 } },
            steps: [
                {
                    id: 'bass',
                    kind: 'each',
                    selector: 'bass',
                    as: 'clip',
                    body: [
                        {
                            id: 'velocity',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: {
                                clipId: { itemId: 'clip' },
                                velocity: { literal: 90 },
                            },
                        },
                    ],
                },
            ],
        };
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'compile-1', name: 'transform.compile', arguments: { document: JSON.stringify(document) } },
                    {
                        id: 'catalog-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['renameClip'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'proposal-1',
                        name: 'command.batch.propose',
                        arguments: {
                            compiledCallIds: ['compile-1'],
                            commands: [
                                { name: 'renameClip', arguments: { clipId: 'clip-bass-verse', name: 'set 100' } },
                            ],
                        },
                    },
                ],
            });
        const result = await parsePromptToActions(
            'set note velocities in Bass Verse to 90, excluding Lead, rename Bass Verse to "set 100"',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.type)).toEqual(['setAllVelocities', 'renameClip']);
        expect(result.actions[0]).toMatchObject({ payload: { clipId: 'clip-bass-verse', velocity: 90 } });
        expect(result.actions[1]).toMatchObject({ payload: { clipId: 'clip-bass-verse', name: 'set 100' } });
    });

    it('rejects a compiled Chorus edit when an unquoted colliding exclusion has an unresolved member', async () => {
        const context = {
            ...CONTEXT,
            tracks: [
                {
                    ...CONTEXT.tracks[0]!,
                    clips: [
                        {
                            id: 'clip-chorus',
                            name: 'Chorus',
                            type: 'midi' as const,
                            startBeat: 0,
                            endBeat: 8,
                            noteCount: 4,
                        },
                        {
                            id: 'clip-chorus-missing',
                            name: 'Chorus and Missing',
                            type: 'midi' as const,
                            startBeat: 8,
                            endBeat: 16,
                            noteCount: 4,
                        },
                    ],
                },
            ],
        };
        const document = {
            ...DOCUMENT,
            selectors: { chorus: { target: 'clip', where: { nameIncludes: 'Chorus' }, limit: 1 } },
            steps: [
                {
                    id: 'chorus',
                    kind: 'emit',
                    operation: 'setAllVelocities',
                    arguments: {
                        clipId: { literal: 'clip-chorus' },
                        velocity: { literal: 90 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Chorus MIDI clip to 90, excluding Chorus and Missing',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected or unresolved target');
    });

    it('rejects a compiled Verse edit when an exact whole-name exclusion hides only unresolved members', async () => {
        const context = {
            ...CONTEXT,
            tracks: [
                {
                    ...CONTEXT.tracks[0]!,
                    clips: [
                        ...CONTEXT.tracks[0]!.clips,
                        {
                            id: 'clip-alpha-and-omega',
                            name: 'Alpha and Omega',
                            type: 'midi' as const,
                            startBeat: 16,
                            endBeat: 24,
                            noteCount: 4,
                        },
                    ],
                },
            ],
        };
        const document = {
            ...DOCUMENT,
            selectors: { verse: { target: 'clip', where: { nameIncludes: 'Verse' }, limit: 1 } },
            steps: [
                {
                    id: 'verse',
                    kind: 'emit',
                    operation: 'setAllVelocities',
                    arguments: {
                        clipId: { literal: 'clip-verse' },
                        velocity: { literal: 90 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse MIDI clip to 90, excluding Alpha and Omega',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected or unresolved target');
    });

    it.each([
        [
            'create a MIDI track named Lead and add an empty MIDI clip named Melody on that new track from beat 0 to beat 4',
            false,
            'Requested empty clip cannot receive proposed notes',
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody',
            true,
            null,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to "Melody"',
            true,
            null,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody MIDI clip',
            true,
            null,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody Pad',
            false,
            'Batch-local target is not grounded in the user request',
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody Pad with a label "to Melody"',
            false,
            'Batch-local target is not grounded in the user request',
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Other on Melody',
            false,
            'Batch-local target is not grounded in the user request',
        ],
    ])(
        'scopes an ordinary note proposal beside selected transform emissions for %s',
        async (prompt, allowed, rejection) => {
            const document = {
                ...DOCUMENT,
                selectors: {},
                steps: [
                    {
                        id: 'lead',
                        kind: 'emit',
                        operation: 'addTrack',
                        binding: 'lead',
                        arguments: { name: { literal: 'Lead' }, kind: { literal: 'midi' } },
                    },
                    {
                        id: 'melody',
                        kind: 'emit',
                        operation: 'addClip',
                        binding: 'melody',
                        dependsOn: ['lead'],
                        arguments: {
                            trackId: { bindingRef: 'lead' },
                            name: { literal: 'Melody' },
                            startBeat: { literal: 0 },
                            endBeat: { literal: 4 },
                        },
                    },
                ],
            };
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'compile-1',
                            name: 'transform.compile',
                            arguments: { document: JSON.stringify(document) },
                        },
                        {
                            id: 'catalog-1',
                            name: 'agent.catalog.discover',
                            arguments: {
                                category: 'command',
                                names: ['addNotes'],
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'propose-1',
                            name: 'command.batch.propose',
                            arguments: {
                                compiledCallIds: ['compile-1'],
                                commands: [
                                    {
                                        name: 'addNotes',
                                        arguments: {
                                            clipId: '$melody',
                                            notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                });
            const result = await parsePromptToActions(prompt, CONTEXT, undefined, 'revision-transform-1');
            expect(result.applicationToolReceipts?.[0]).toMatchObject({ status: 'success' });
            if (allowed) {
                expect(result.rejectionReason).toBeUndefined();
                expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes']);
            } else {
                expect(result.actions).toEqual([]);
                expect(result.rejectionReason).toContain(rejection);
            }
        }
    );

    it('keeps original exclusions on ordinary calls mixed with selected transform emissions', async () => {
        const document = {
            ...DOCUMENT,
            selectors: { verse: { target: 'clip', where: { nameIncludes: 'Verse' }, limit: 1 } },
            steps: [
                {
                    id: 'verse',
                    kind: 'each',
                    selector: 'verse',
                    as: 'clip',
                    body: [
                        {
                            id: 'velocity',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: {
                                clipId: { itemId: 'clip' },
                                velocity: { literal: 90 },
                            },
                        },
                    ],
                },
            ],
        };
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'compile-1', name: 'transform.compile', arguments: { document: JSON.stringify(document) } },
                    {
                        id: 'catalog-1',
                        name: 'agent.catalog.discover',
                        arguments: {
                            category: 'command',
                            names: ['setAllVelocities'],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'proposal-1',
                        name: 'command.batch.propose',
                        arguments: {
                            compiledCallIds: ['compile-1'],
                            commands: [
                                { name: 'setAllVelocities', arguments: { clipId: 'clip-chorus', velocity: 100 } },
                            ],
                        },
                    },
                ],
            });
        const result = await parsePromptToActions(
            'set note velocities in Verse MIDI clip to 90, excluding Chorus; set note velocities in Chorus MIDI clip to 100',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.applicationToolReceipts?.[0]).toMatchObject({ status: 'success' });
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('protected or unresolved target');
    });

    it.each([
        [
            'create a MIDI track named Lead and add an empty MIDI clip named Melody on that new track from beat 0 to beat 4',
            false,
            false,
            'empty clip',
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody',
            true,
            false,
            null,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody Pad',
            false,
            false,
            'Batch-local target is not grounded',
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody',
            false,
            true,
            'Provider action is not grounded in the user request',
        ],
    ])(
        'keeps a structured creation consumer within the request authority for %s',
        async (prompt, allowed, extraProducer, rejection) => {
            const commands = [
                { id: 'lead', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
                {
                    id: 'melody',
                    name: 'addClip',
                    arguments: {
                        trackId: '$lead',
                        name: 'Melody',
                        startBeat: 0,
                        endBeat: 4,
                        binding: 'melody',
                    },
                    dependsOn: ['lead'],
                },
                {
                    id: 'note',
                    name: 'addNotes',
                    arguments: {
                        clipId: '$melody',
                        notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                    },
                    dependsOn: ['melody'],
                },
            ];
            if (extraProducer) {
                commands.unshift({
                    id: 'sneaky',
                    name: 'addTrack',
                    arguments: { name: 'Sneaky', kind: 'midi', binding: 'sneaky' },
                });
            }
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'catalog-1',
                            name: 'agent.catalog.discover',
                            arguments: {
                                category: 'command',
                                names: ['addTrack', 'addClip', 'addNotes'],
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'propose-1',
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Create a MIDI track and clip.',
                                    constraints: [],
                                    scope: {
                                        targetIds: [],
                                        targetRanges: [],
                                        protectedTargetIds: [],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: ['addTrack', 'addClip', 'addNotes'],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: ['Check command targets.'],
                                    stoppingConditions: ['Stop if revision changes.'],
                                },
                                list: { schemaVersion: 1, items: commands },
                            },
                        },
                    ],
                });
            const result = await parsePromptToActions(prompt, CONTEXT, undefined, 'revision-transform-1');
            if (allowed) {
                expect(result.rejectionReason).toBeUndefined();
                expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes']);
            } else {
                expect(result.actions).toEqual([]);
                expect(result.rejectionReason).toContain(rejection);
            }
        }
    );

    it.each([
        ['Lead', true],
        ['Bass', false],
    ])('binds a structured consumer to its requested owner on %s', async (ownerName, allowed) => {
        const commands = [
            { id: 'lead', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
            { id: 'bass', name: 'addTrack', arguments: { name: 'Bass', kind: 'midi', binding: 'bass' } },
            {
                id: 'melody',
                name: 'addClip',
                dependsOn: ['lead'],
                arguments: { trackId: '$lead', name: 'Melody', startBeat: 0, endBeat: 4, binding: 'melody' },
            },
            {
                id: 'notes',
                name: 'addNotes',
                dependsOn: ['melody'],
                arguments: { clipId: '$melody', notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
            },
        ];
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'catalog-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['addTrack', 'addClip', 'addNotes'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'proposal-1',
                        name: 'command.batch.propose',
                        arguments: {
                            plan: {
                                semantic: { classification: 'simple', uncertainty: [] },
                                objective: 'Create named tracks and add notes to the Melody clip.',
                                constraints: [],
                                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                                capabilityIds: ['addTrack', 'addClip', 'addNotes'],
                                assetIds: [],
                                alternatives: [],
                                validationStrategy: ['Check owner and target.'],
                                stoppingConditions: ['Stop if revision changes.'],
                            },
                            list: { schemaVersion: 1, items: commands },
                        },
                    },
                ],
            });
        const result = await parsePromptToActions(
            `create a MIDI track named Lead; create a MIDI track named Bass; add a MIDI clip named Melody on the new Lead track from beat 0 to beat 4; add notes to Melody on ${ownerName} track`,
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        if (allowed) {
            expect(result.rejectionReason).toBeUndefined();
            expect(result.actions.map((action) => action.type)).toEqual([
                'addTrack',
                'addTrack',
                'addClip',
                'addNotes',
            ]);
        } else {
            expect(result.actions).toEqual([]);
            expect(result.rejectionReason).toContain('Batch-local target is not grounded');
        }
    });

    it('refuses a compiled set that omits or adds a named clip', async () => {
        const oneClip = {
            ...DOCUMENT,
            selectors: { clips: { target: 'clip', where: { nameIncludes: 'Verse' }, limit: 1 } },
        };
        planCalls(['compile-1'], oneClip);
        const omitted = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(omitted.actions).toEqual([]);
        expect(omitted.rejectionReason).toContain('exact request target set');

        vi.clearAllMocks();
        const thirdClip = {
            id: 'clip-bridge',
            name: 'Bridge',
            type: 'midi' as const,
            startBeat: 16,
            endBeat: 24,
            noteCount: 4,
        };
        const context = {
            ...CONTEXT,
            tracks: [{ ...CONTEXT.tracks[0]!, clips: [...CONTEXT.tracks[0]!.clips, thirdClip] }],
        };
        const threeClips = {
            ...DOCUMENT,
            selectors: { clips: { target: 'clip', where: { contentType: 'midi' }, limit: 3 } },
            steps: [
                {
                    ...DOCUMENT.steps[0]!,
                    body: [
                        {
                            ...DOCUMENT.steps[0]!.body[0]!,
                            condition: {
                                ...DOCUMENT.steps[0]!.body[0]!.condition,
                                right: { node: 'const', quantity: { unit: 'count', value: 3 } },
                            },
                        },
                    ],
                },
            ],
        };
        planCalls(['compile-1'], threeClips);
        const added = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(added.actions).toEqual([]);
        expect(added.rejectionReason).toContain('exact request target set');
    });

    it('refuses duplicate display names and protected members', async () => {
        planCalls();
        const duplicateContext = {
            ...CONTEXT,
            tracks: [
                {
                    ...CONTEXT.tracks[0]!,
                    clips: [CONTEXT.tracks[0]!.clips[0]!, { ...CONTEXT.tracks[0]!.clips[1]!, name: 'Verse' }],
                },
            ],
        };
        const duplicate = await parsePromptToActions(
            'set note velocities in Verse MIDI clips to 90',
            duplicateContext,
            undefined,
            'revision-transform-1'
        );
        expect(duplicate.actions).toEqual([]);

        vi.clearAllMocks();
        planCalls();
        const protectedResult = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90 but leave Chorus unchanged',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(protectedResult.actions).toEqual([]);
        expect(protectedResult.rejectionReason).toContain('protected or unresolved target');
    });

    it('keeps two same-action clauses with different values in separate target sets', async () => {
        const document = {
            ...DOCUMENT,
            selectors: {
                verse: { target: 'clip', where: { nameIncludes: 'Verse' }, limit: 1 },
                chorus: { target: 'clip', where: { nameIncludes: 'Chorus' }, limit: 1 },
            },
            steps: [
                {
                    id: 'verse-each',
                    kind: 'each',
                    selector: 'verse',
                    as: 'clip',
                    body: [
                        {
                            id: 'verse-emit',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: {
                                clipId: { itemId: 'clip' },
                                velocity: { literal: 90 },
                            },
                        },
                    ],
                },
                {
                    id: 'chorus-each',
                    kind: 'each',
                    selector: 'chorus',
                    as: 'clip',
                    body: [
                        {
                            id: 'chorus-emit',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: {
                                clipId: { itemId: 'clip' },
                                velocity: { literal: 100 },
                            },
                        },
                    ],
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse MIDI clip to 90; set note velocities in Chorus MIDI clip to 100',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 100 }),
        ]);
    });

    it('grounds a plural compiled clause followed by a different-value singular clause', async () => {
        const bridgeClip = {
            id: 'clip-bridge',
            name: 'Bridge',
            type: 'midi' as const,
            startBeat: 16,
            endBeat: 24,
            noteCount: 4,
        };
        const context = {
            ...CONTEXT,
            tracks: [{ ...CONTEXT.tracks[0]!, clips: [...CONTEXT.tracks[0]!.clips, bridgeClip] }],
        };
        const document = {
            ...DOCUMENT,
            selectors: {
                first: { target: 'clip', where: { contentType: 'midi', nameIncludes: 'Verse' }, limit: 1 },
                second: { target: 'clip', where: { contentType: 'midi', nameIncludes: 'Chorus' }, limit: 1 },
                third: { target: 'clip', where: { contentType: 'midi', nameIncludes: 'Bridge' }, limit: 1 },
            },
            steps: [
                ...(['first', 'second'] as const).map((selector) => ({
                    id: `${selector}-each`,
                    kind: 'each',
                    selector,
                    as: 'clip',
                    body: [
                        {
                            id: `${selector}-emit`,
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: { clipId: { itemId: 'clip' }, velocity: { literal: 90 } },
                        },
                    ],
                })),
                {
                    id: 'third-each',
                    kind: 'each',
                    selector: 'third',
                    as: 'clip',
                    body: [
                        {
                            id: 'third-emit',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: { clipId: { itemId: 'clip' }, velocity: { literal: 100 } },
                        },
                    ],
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-bridge', velocity: 100 }),
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');

        vi.clearAllMocks();
        planCalls(['compile-1'], { ...document, steps: [document.steps[2], document.steps[0], document.steps[1]] });
        const reordered = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(reordered.rejectionReason).toBeUndefined();
        expect(reordered.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-bridge', velocity: 100 }),
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
        ]);

        vi.clearAllMocks();
        planCalls(['compile-1'], document);
        const reversedClauses = await parsePromptToActions(
            'set note velocities in Bridge MIDI clip to 100; set note velocities in Verse and Chorus MIDI clips to 90',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(reversedClauses.rejectionReason).toBeUndefined();
        expect(reversedClauses.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-bridge', velocity: 100 }),
        ]);

        vi.clearAllMocks();
        const sameValue = {
            ...document,
            steps: [
                ...document.steps.slice(0, 2),
                {
                    ...document.steps[2]!,
                    body: [
                        {
                            ...document.steps[2]!.body[0]!,
                            arguments: { clipId: { itemId: 'clip' }, velocity: { literal: 90 } },
                        },
                    ],
                },
            ],
        };
        planCalls(['compile-1'], sameValue);
        const repeatedValue = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 90',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(repeatedValue.rejectionReason).toBeUndefined();
        expect(repeatedValue.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-bridge', velocity: 90 }),
        ]);

        const wrongValues = {
            ...document,
            steps: document.steps.map((step, index) => ({
                ...step,
                body: [
                    {
                        ...step.body[0]!,
                        arguments: { clipId: { itemId: 'clip' }, velocity: { literal: index === 2 ? 90 : 100 } },
                    },
                ],
            })),
        };
        const outroClip = {
            id: 'clip-outro',
            name: 'Outro',
            type: 'midi' as const,
            startBeat: 24,
            endBeat: 32,
            noteCount: 4,
        };
        const contextWithOutro = {
            ...context,
            tracks: [{ ...context.tracks[0]!, clips: [...context.tracks[0]!.clips, outroClip] }],
        };
        const extraTarget = {
            ...document,
            selectors: {
                ...document.selectors,
                outro: { target: 'clip', where: { nameIncludes: 'Outro' }, limit: 1 },
            },
            steps: [
                ...document.steps,
                {
                    id: 'outro-each',
                    kind: 'each',
                    selector: 'outro',
                    as: 'clip',
                    body: [
                        {
                            id: 'outro-emit',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: { clipId: { itemId: 'clip' }, velocity: { literal: 100 } },
                        },
                    ],
                },
            ],
        };
        vi.clearAllMocks();
        planCalls(['compile-1'], extraTarget);
        const pluralGroups = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge and Outro MIDI clips to 100',
            contextWithOutro,
            undefined,
            'revision-transform-1'
        );
        expect(pluralGroups.rejectionReason).toBeUndefined();
        expect(pluralGroups.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-bridge', velocity: 100 }),
            expect.objectContaining({ clipId: 'clip-outro', velocity: 100 }),
        ]);

        vi.clearAllMocks();
        const threeGroups = {
            ...extraTarget,
            steps: [
                ...extraTarget.steps.slice(0, 3),
                {
                    ...extraTarget.steps[3]!,
                    body: [
                        {
                            ...extraTarget.steps[3]!.body[0]!,
                            arguments: { clipId: { itemId: 'clip' }, velocity: { literal: 110 } },
                        },
                    ],
                },
            ],
        };
        planCalls(['compile-1'], threeGroups);
        const threeClauses = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100; set note velocities in Outro MIDI clip to 110',
            contextWithOutro,
            undefined,
            'revision-transform-1'
        );
        expect(threeClauses.rejectionReason).toBeUndefined();
        expect(threeClauses.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-chorus', velocity: 90 }),
            expect.objectContaining({ clipId: 'clip-bridge', velocity: 100 }),
            expect.objectContaining({ clipId: 'clip-outro', velocity: 110 }),
        ]);

        for (const [prompt, rejectedDocument, rejectedContext] of [
            [
                'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100',
                { ...document, steps: document.steps.slice(1) },
                context,
            ],
            [
                'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100',
                wrongValues,
                context,
            ],
            [
                'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100',
                extraTarget,
                contextWithOutro,
            ],
            [
                'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Bridge MIDI clip to 100 but leave Chorus unchanged',
                document,
                context,
            ],
            [
                'set note velocities in Verse and Chorus MIDI clips to 90; set note velocities in Chorus and Bridge MIDI clips to 100',
                document,
                context,
            ],
        ] as const) {
            vi.clearAllMocks();
            planCalls(['compile-1'], rejectedDocument);
            const rejected = await parsePromptToActions(prompt, rejectedContext, undefined, 'revision-transform-1');
            expect(rejected.actions).toEqual([]);
            expect(rejected.rejectionReason).toBeDefined();
        }
    });

    it('rejects an incomplete or ineligible captured MIDI selection', async () => {
        planCalls();
        const missing = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            { ...CONTEXT, selectedClipIds: ['clip-verse', 'clip-chorus', 'clip-missing'] },
            undefined,
            'revision-transform-1'
        );
        expect(missing.actions).toEqual([]);

        vi.clearAllMocks();
        planCalls();
        const audio = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            {
                ...CONTEXT,
                tracks: [
                    {
                        ...CONTEXT.tracks[0]!,
                        clips: [
                            ...CONTEXT.tracks[0]!.clips,
                            {
                                id: 'clip-audio',
                                name: 'Audio',
                                type: 'audio' as const,
                                startBeat: 16,
                                endBeat: 24,
                                noteCount: 0,
                            },
                        ],
                    },
                ],
                selectedClipIds: ['clip-verse', 'clip-chorus', 'clip-audio'],
            },
            undefined,
            'revision-transform-1'
        );
        expect(audio.actions).toEqual([]);
    });

    it('treats a quoted selection-like clip name as a literal name', async () => {
        const document = {
            ...DOCUMENT,
            selectors: { clips: { target: 'clip', where: { nameIncludes: 'selected MIDI clips' }, limit: 1 } },
        };
        planCalls(['compile-1'], document);
        const context = {
            ...CONTEXT,
            tracks: [
                {
                    ...CONTEXT.tracks[0]!,
                    clips: [
                        { ...CONTEXT.tracks[0]!.clips[0]!, name: 'selected MIDI clips' },
                        CONTEXT.tracks[0]!.clips[1]!,
                    ],
                },
            ],
        };
        const result = await parsePromptToActions(
            'set note velocities in "selected MIDI clips" MIDI clip to 90',
            context,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ clipId: 'clip-verse', velocity: 90 }),
        ]);
    });

    it('retains an explicit dependency between two existing-clip edits', async () => {
        const document = {
            ...DOCUMENT,
            steps: [
                {
                    id: 'verse',
                    kind: 'emit',
                    operation: 'setAllVelocities',
                    arguments: {
                        clipId: { literal: 'clip-verse' },
                        velocity: { literal: 90 },
                    },
                },
                {
                    id: 'chorus',
                    kind: 'emit',
                    operation: 'setAllVelocities',
                    dependsOn: ['verse'],
                    arguments: {
                        clipId: { literal: 'clip-chorus' },
                        velocity: { literal: 100 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse MIDI clip to 90; set note velocities in Chorus MIDI clip to 100',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actionCommandGraph?.dependenciesByActionIndex).toEqual([[], [0]]);
    });

    it('combines a structured-list command with selected transform emissions in one indexed batch', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'compile-1', name: 'transform.compile', arguments: { document: JSON.stringify(DOCUMENT) } },
                    {
                        id: 'catalog-1',
                        name: 'agent.catalog.discover',
                        arguments: {
                            category: 'command',
                            names: ['muteTrack'],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'proposal-1',
                        name: 'command.batch.propose',
                        arguments: {
                            compiledCallIds: ['compile-1'],
                            plan: {
                                semantic: { classification: 'simple', uncertainty: [] },
                                objective: 'Set MIDI velocities and mute the MIDI track.',
                                constraints: [],
                                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                                capabilityIds: ['setAllVelocities', 'muteTrack'],
                                assetIds: [],
                                alternatives: [],
                                validationStrategy: ['Check exact targets and values.'],
                                stoppingConditions: ['Stop if revision changes.'],
                            },
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'mute-midi',
                                        name: 'muteTrack',
                                        arguments: { muted: true },
                                        selector: {
                                            targetArgument: 'trackId',
                                            entity: 'track',
                                            match: { all: [{ kind: 'midi' }] },
                                            quantity: { unit: 'targets', exactly: 1 },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            });
        const result = await parsePromptToActions(
            'set note velocities in Verse and Chorus MIDI clips to 90, then mute all MIDI tracks',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.type)).toEqual([
            'setAllVelocities',
            'setAllVelocities',
            'muteTrack',
        ]);
        expect(result.actionCommandGraph?.dependenciesByActionIndex).toEqual([[], [], []]);
        expect(result.matchSelectorPredicates?.[0]?.actionPositions).toEqual([2]);
    });

    it('rejects an extra selected-transform creation beside an authorized structured creation chain', async () => {
        const document = {
            ...DOCUMENT,
            selectors: {},
            steps: [
                {
                    id: 'sneaky',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'sneaky',
                    arguments: { name: { literal: 'Sneaky' }, kind: { literal: 'midi' } },
                },
            ],
        };
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'compile-1', name: 'transform.compile', arguments: { document: JSON.stringify(document) } },
                    {
                        id: 'catalog-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['addTrack', 'addClip', 'addNotes'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'proposal-1',
                        name: 'command.batch.propose',
                        arguments: {
                            compiledCallIds: ['compile-1'],
                            plan: {
                                semantic: { classification: 'simple', uncertainty: [] },
                                objective: 'Create Lead and Melody with notes.',
                                constraints: [],
                                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                                capabilityIds: ['addTrack', 'addClip', 'addNotes'],
                                assetIds: [],
                                alternatives: [],
                                validationStrategy: ['Check command targets.'],
                                stoppingConditions: ['Stop if revision changes.'],
                            },
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'lead',
                                        name: 'addTrack',
                                        arguments: { name: 'Lead', kind: 'midi', binding: 'lead' },
                                    },
                                    {
                                        id: 'melody',
                                        name: 'addClip',
                                        arguments: {
                                            trackId: '$lead',
                                            name: 'Melody',
                                            startBeat: 0,
                                            endBeat: 4,
                                            binding: 'melody',
                                        },
                                        dependsOn: ['lead'],
                                    },
                                    {
                                        id: 'notes',
                                        name: 'addNotes',
                                        arguments: {
                                            clipId: '$melody',
                                            notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                                        },
                                        dependsOn: ['melody'],
                                    },
                                ],
                            },
                        },
                    },
                ],
            });
        const result = await parsePromptToActions(
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then add notes to Melody',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.applicationToolReceipts?.[0]).toMatchObject({ status: 'success' });
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('Provider value name does not match the user request');
    });

    it.each([
        ['Lead', false],
        ['Bass', true],
    ] as const)(
        'spends named creation slots across transform and ordinary origins with %s',
        async (ordinaryName, allowed) => {
            const document = {
                ...DOCUMENT,
                selectors: {},
                steps: [
                    {
                        id: 'lead-transform',
                        kind: 'emit',
                        operation: 'addTrack',
                        binding: 'lead-transform',
                        arguments: { name: { literal: 'Lead' }, kind: { literal: 'midi' } },
                    },
                ],
            };
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'compile-1',
                            name: 'transform.compile',
                            arguments: { document: JSON.stringify(document) },
                        },
                        {
                            id: 'catalog-1',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['addTrack'] },
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'proposal-1',
                            name: 'command.batch.propose',
                            arguments: {
                                compiledCallIds: ['compile-1'],
                                commands: [
                                    {
                                        name: 'addTrack',
                                        arguments: { name: ordinaryName, kind: 'midi', binding: 'ordinary-track' },
                                    },
                                ],
                            },
                        },
                    ],
                });

            const result = await parsePromptToActions(
                'create 2 MIDI tracks named Lead and Bass',
                CONTEXT,
                undefined,
                'revision-transform-1'
            );

            expect(
                result.actions.map((action) => (action.type === 'addTrack' ? action.payload.name : action.type))
            ).toEqual(allowed ? ['Lead', 'Bass'] : []);
            if (!allowed) {
                expect(result.rejectionReason).toContain('not grounded');
            }
        }
    );

    it.each([
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then rename Melody clip to Harmony',
            true,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then rename clip Melody to Harmony',
            true,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4',
            false,
        ],
        [
            'create a MIDI track named Lead and add a MIDI clip named Melody on that new track from beat 0 to beat 4, then rename Melody Pad clip to Harmony',
            false,
        ],
    ])('scopes a selected-transform consumer of its own creation for %s', async (prompt, allowed) => {
        const document = {
            ...DOCUMENT,
            selectors: {},
            steps: [
                {
                    id: 'lead',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'lead',
                    arguments: { name: { literal: 'Lead' }, kind: { literal: 'midi' } },
                },
                {
                    id: 'melody',
                    kind: 'emit',
                    operation: 'addClip',
                    binding: 'melody',
                    dependsOn: ['lead'],
                    arguments: {
                        trackId: { bindingRef: 'lead' },
                        name: { literal: 'Melody' },
                        startBeat: { literal: 0 },
                        endBeat: { literal: 4 },
                    },
                },
                {
                    id: 'rename',
                    kind: 'emit',
                    operation: 'renameClip',
                    dependsOn: ['melody'],
                    arguments: { clipId: { bindingRef: 'melody' }, name: { literal: 'Harmony' } },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(prompt, CONTEXT, undefined, 'revision-transform-1');
        expect(result.applicationToolReceipts?.[0]).toMatchObject({ status: 'success' });
        if (allowed) {
            expect(result.rejectionReason).toBeUndefined();
            expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'renameClip']);
            expect(result.actionCommandGraph?.dependenciesByActionIndex).toEqual([[], [0], [1]]);
        } else {
            expect(result.actions).toEqual([]);
            expect(result.rejectionReason).toContain('not grounded');
        }
    });

    it('preserves every emitted dependency and binding producer in the approval graph', async () => {
        const document = {
            ...DOCUMENT,
            steps: [
                ...DOCUMENT.steps,
                {
                    id: 'add-lead-track',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'lead',
                    arguments: {
                        name: { literal: 'Lead' },
                        kind: { literal: 'midi' },
                    },
                },
                {
                    id: 'add-lead-clip',
                    kind: 'emit',
                    operation: 'addClip',
                    dependsOn: ['emit-velocity', 'add-lead-track'],
                    arguments: {
                        trackId: { bindingRef: 'lead' },
                        name: { literal: 'Lead Take' },
                        startBeat: { literal: 2 },
                        endBeat: { literal: 6 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90, then create a MIDI track named Lead and add a MIDI clip named Lead Take on that new track from beat 2 to beat 6',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.type)).toEqual([
            'setAllVelocities',
            'setAllVelocities',
            'addTrack',
            'addClip',
        ]);
        expect(result.actionCommandGraph).toMatchObject({
            dependenciesByActionIndex: [[], [], [], [0, 1, 2]],
            batchLocalBindings: [{ bindingId: '$lead', producerActionIndex: 2, producerArgument: 'id' }],
        });
    });

    it('refuses the whole creation graph when a clip is redirected to an unrelated existing track', async () => {
        const document = {
            ...DOCUMENT,
            selectors: {},
            steps: [
                {
                    id: 'make-piano',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'piano',
                    arguments: {
                        name: { literal: 'Piano' },
                        kind: { literal: 'midi' },
                    },
                },
                {
                    id: 'make-melody',
                    kind: 'emit',
                    operation: 'addClip',
                    dependsOn: ['make-piano'],
                    arguments: {
                        trackId: { literal: 'track-keys' },
                        name: { literal: 'Melody' },
                        startBeat: { literal: 0 },
                        endBeat: { literal: 4 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'create a MIDI track named Piano and add a MIDI clip named Melody on that new track from beat 0 to beat 4',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('Provider action rejected');
    });

    it('keeps two same-type creation producers and their consumers distinct', async () => {
        const document = {
            ...DOCUMENT,
            selectors: {},
            steps: [
                {
                    id: 'make-piano',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'piano',
                    arguments: {
                        name: { literal: 'Piano' },
                        kind: { literal: 'midi' },
                    },
                },
                {
                    id: 'make-bass',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'bass',
                    arguments: {
                        name: { literal: 'Bass' },
                        kind: { literal: 'midi' },
                    },
                },
                {
                    id: 'make-melody',
                    kind: 'emit',
                    operation: 'addClip',
                    dependsOn: ['make-piano'],
                    arguments: {
                        trackId: { bindingRef: 'piano' },
                        name: { literal: 'Melody' },
                        startBeat: { literal: 0 },
                        endBeat: { literal: 4 },
                    },
                },
                {
                    id: 'make-bassline',
                    kind: 'emit',
                    operation: 'addClip',
                    dependsOn: ['make-bass'],
                    arguments: {
                        trackId: { bindingRef: 'bass' },
                        name: { literal: 'Bassline' },
                        startBeat: { literal: 4 },
                        endBeat: { literal: 8 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'create a MIDI track named Piano; create a MIDI track named Bass; add a MIDI clip named Melody on the new Piano track from beat 0 to beat 4; add a MIDI clip named Bassline on the new Bass track from beat 4 to beat 8',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addTrack', 'addClip', 'addClip']);
        expect(result.actionCommandGraph).toMatchObject({
            dependenciesByActionIndex: [[], [], [0], [1]],
            batchLocalBindings: [
                { bindingId: '$piano', producerActionIndex: 0, producerArgument: 'id' },
                { bindingId: '$bass', producerActionIndex: 1, producerArgument: 'id' },
            ],
        });
        const piano = result.actions[0];
        const bass = result.actions[1];
        expect(piano?.type).toBe('addTrack');
        expect(bass?.type).toBe('addTrack');
        if (piano?.type !== 'addTrack' || bass?.type !== 'addTrack') {
            throw new Error('Expected two created MIDI tracks');
        }
        expect(piano.payload.id).not.toBe(bass.payload.id);
        expect(result.actions[2]).toMatchObject({ type: 'addClip', payload: { trackId: piano.payload.id } });
        expect(result.actions[3]).toMatchObject({ type: 'addClip', payload: { trackId: bass.payload.id } });
    });

    it('preserves indexes when existing edits surround a bound creation chain', async () => {
        const document = {
            ...DOCUMENT,
            selectors: {},
            steps: [
                {
                    id: 'verse',
                    kind: 'emit',
                    operation: 'setAllVelocities',
                    arguments: {
                        clipId: { literal: 'clip-verse' },
                        velocity: { literal: 90 },
                    },
                },
                {
                    id: 'lead',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'lead',
                    arguments: {
                        name: { literal: 'Lead' },
                        kind: { literal: 'midi' },
                    },
                },
                {
                    id: 'mute',
                    kind: 'emit',
                    operation: 'muteTrack',
                    arguments: {
                        trackId: { literal: 'track-keys' },
                        muted: { literal: true },
                    },
                },
                {
                    id: 'lead-clip',
                    kind: 'emit',
                    operation: 'addClip',
                    dependsOn: ['verse', 'lead'],
                    arguments: {
                        trackId: { bindingRef: 'lead' },
                        name: { literal: 'Lead Take' },
                        startBeat: { literal: 2 },
                        endBeat: { literal: 6 },
                    },
                },
                {
                    id: 'chorus',
                    kind: 'emit',
                    operation: 'setAllVelocities',
                    dependsOn: ['lead-clip'],
                    arguments: {
                        clipId: { literal: 'clip-chorus' },
                        velocity: { literal: 100 },
                    },
                },
            ],
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse MIDI clip to 90; create a MIDI track named Lead; mute Keys MIDI track; add a MIDI clip named Lead Take on that new track from beat 2 to beat 6; set note velocities in Chorus MIDI clip to 100',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions.map((action) => action.type)).toEqual([
            'setAllVelocities',
            'addTrack',
            'muteTrack',
            'addClip',
            'setAllVelocities',
        ]);
        expect(result.actionCommandGraph).toMatchObject({
            dependenciesByActionIndex: [[], [], [], [0, 1], [3]],
            batchLocalBindings: [{ bindingId: '$lead', producerActionIndex: 1, producerArgument: 'id' }],
        });
    });

    it('charges flattened compiled creations against the shared 12-object budget', async () => {
        const tracks = Array.from({ length: 12 }, (_, index) => ({
            id: `track-${String(index)}`,
            kind: 'emit',
            operation: 'addTrack',
            binding: `track-${String(index)}`,
            arguments: { name: { literal: `MIDI ${String(index)}` }, kind: { literal: 'midi' } },
        }));
        planCalls(['compile-1'], { ...DOCUMENT, selectors: {}, steps: tracks });
        const atLimit = await parsePromptToActions('create 12 MIDI tracks', CONTEXT, undefined, 'revision-transform-1');
        expect(atLimit.rejectionReason).toBeUndefined();
        expect(atLimit.actions).toHaveLength(12);

        vi.clearAllMocks();
        planCalls(['compile-1'], {
            ...DOCUMENT,
            selectors: {},
            steps: [
                ...tracks,
                {
                    id: 'copy-one',
                    kind: 'emit',
                    operation: 'duplicateTrack',
                    arguments: {
                        trackId: { literal: 'track-keys' },
                    },
                },
            ],
        });
        const overLimit = await parsePromptToActions(
            'create 12 MIDI tracks and duplicate Keys MIDI track',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(overLimit.actions).toEqual([]);
        expect(overLimit.rejectionReason).toContain('more than 12 project objects');
    });

    it('rejects an unknown selected call ID without treating provider text as compiled output', async () => {
        planCalls(['unknown']);
        const result = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('unknown, duplicate, or failed transform compilation');
    });

    it('refuses duplicate and failed selected compilation references', async () => {
        planCalls(['compile-1', 'compile-1']);
        const duplicate = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(duplicate.actions).toEqual([]);
        expect(duplicate.rejectionReason).toContain('unknown, duplicate, or failed transform compilation');

        vi.clearAllMocks();
        planCalls(['compile-1'], { ...DOCUMENT, seed: -1 });
        const failed = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(failed.applicationToolReceipts?.[0]).toMatchObject({ status: 'failure' });
        expect(failed.actions).toEqual([]);
        expect(failed.rejectionReason).toContain('unknown, duplicate, or failed transform compilation');
    });

    it('allows a successful compilation to remain unused when the planner declines', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'compile-1', name: 'transform.compile', arguments: { document: JSON.stringify(DOCUMENT) } },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'decline-1',
                        name: 'command.batch.decline',
                        arguments: {
                            kind: 'clarify',
                            reason: 'The clip choice is unclear.',
                            questions: ['Which clips?'],
                        },
                    },
                ],
            });
        const result = await parsePromptToActions(
            'set note velocities in the selected MIDI clips to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.applicationToolReceipts?.[0]).toMatchObject({ status: 'success' });
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBeUndefined();
    });

    it('does not retain an over-budget receipt as a successful compilation and refuses stale references', async () => {
        const snapshot = projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1');
        const compileCall = {
            id: 'compile-1',
            name: 'transform.compile',
            arguments: { document: JSON.stringify(DOCUMENT) },
        };
        const proposalCall = {
            name: 'command.batch.propose',
            arguments: { commands: [], compiledCallIds: ['compile-1'] },
        };
        const run = (maxReceiptBytesPerCall: number, revision: string) =>
            runApplicationOwnedToolLoop({
                loopId: 'transform-test',
                requestTurn: vi
                    .fn()
                    .mockResolvedValueOnce({ status: 'complete', toolCalls: [compileCall] })
                    .mockResolvedValueOnce({ status: 'complete', toolCalls: [proposalCall] }),
                terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
                limits: { maxReceiptBytesPerCall },
                transform: {
                    toolName: 'transform.compile',
                    revision,
                    execute: (call, context) =>
                        executeTransformCompile({
                            call,
                            callId: context.callId,
                            turn: context.turn,
                            snapshot,
                        }),
                },
            });
        const overBudget = await run(256, 'revision-transform-1');
        expect(overBudget.status).toBe('rejected');
        if (overBudget.status === 'rejected') {
            expect(overBudget.reason).toContain('unknown, duplicate, or failed transform compilation');
            expect(overBudget.receipts[0]?.status).toBe('failure');
        }
        const stale = await run(16_384, 'revision-transform-2');
        expect(stale.status).toBe('rejected');
        if (stale.status === 'rejected') {
            expect(stale.reason).toContain('stale transform compilation');
        }
    });

    it('applies the combined 24-command batch ceiling before a proposal can reach approval', async () => {
        const document = {
            ...DOCUMENT,
            steps: Array.from({ length: 25 }, (_, index) => ({
                id: `emit-${String(index)}`,
                kind: 'emit',
                operation: 'setAllVelocities',
                arguments: { clipId: { literal: 'clip-verse' }, velocity: { literal: 90 } },
            })),
        };
        planCalls(['compile-1'], document);
        const result = await parsePromptToActions(
            'set note velocities in Verse MIDI clip to 90',
            CONTEXT,
            undefined,
            'revision-transform-1'
        );
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('command budget');
    });

    it('enforces seeds, units, selector limits and emitted-command limits in the runtime route', () => {
        const snapshot = projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1');
        const compile = (document: unknown) =>
            executeTransformCompile({
                call: { name: 'transform.compile', arguments: { document: JSON.stringify(document) } },
                callId: 'bounded',
                turn: 1,
                snapshot,
            });
        expect(compile({ ...DOCUMENT, seed: -1 }).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
        expect(compile({ ...DOCUMENT, seed: 2 ** 32 }).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
        expect(compile({ ...DOCUMENT, selectors: { clips: { target: 'clip', limit: 65 } } }).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
        const invalidUnit = {
            ...DOCUMENT,
            variables: {
                velocity: {
                    node: 'const',
                    quantity: { unit: 'milliseconds', value: 90 },
                },
            },
        };
        expect(compile(invalidUnit).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
        const mismatchedUnits = {
            ...DOCUMENT,
            variables: {
                velocity: {
                    node: 'add',
                    left: { node: 'const', quantity: { unit: 'beats', value: 80 } },
                    right: { node: 'const', quantity: { unit: 'count', value: 10 } },
                },
            },
        };
        expect(compile(mismatchedUnits).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'transform-rejected' },
        });
        const unsupportedArrayLiteral = {
            ...DOCUMENT,
            selectors: {},
            steps: [
                {
                    id: 'notes',
                    kind: 'emit',
                    operation: 'addNotes',
                    arguments: {
                        clipId: { literal: 'clip-verse' },
                        notes: { literal: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
                    },
                },
            ],
        };
        expect(compile(unsupportedArrayLiteral).receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
        const emits = Array.from({ length: 33 }, (_, index) => ({
            id: `emit-${String(index)}`,
            kind: 'emit',
            operation: 'setAllVelocities',
            arguments: { clipId: { itemId: 'inner' }, velocity: { literal: 90 } },
        }));
        const overOutput = {
            ...DOCUMENT,
            steps: [
                {
                    id: 'outer-loop',
                    kind: 'each',
                    selector: 'clips',
                    as: 'outer',
                    body: [
                        {
                            id: 'inner-loop',
                            kind: 'each',
                            selector: 'clips',
                            as: 'inner',
                            body: emits,
                        },
                    ],
                },
            ],
        };
        expect(compile(overOutput).receipt).toMatchObject({ status: 'failure', error: { code: 'transform-rejected' } });
    });

    it('refuses malformed nested data before Command compiler traversal', () => {
        let steps: unknown[] = [{ id: 'leaf', kind: 'emit', operation: 'setAllVelocities', arguments: {} }];
        for (let index = 0; index < 100; index += 1) {
            steps = [
                {
                    id: `nest-${String(index)}`,
                    kind: 'each',
                    selector: 'clips',
                    as: `clip-${String(index)}`,
                    body: steps,
                },
            ];
        }
        const call = {
            name: 'transform.compile',
            arguments: { document: JSON.stringify({ ...DOCUMENT, steps }) },
        };
        const result = executeTransformCompile({
            call,
            callId: 'deep',
            turn: 1,
            snapshot: projectDeclarativeTransformSnapshot(CONTEXT, 'revision-transform-1'),
        });
        expect(result.commands).toBeNull();
        expect(result.receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });
});
