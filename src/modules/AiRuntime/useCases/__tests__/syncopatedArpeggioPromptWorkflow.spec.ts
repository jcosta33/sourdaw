import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    trackStore,
    type Clip,
    type Track,
} from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const PROMPT = 'Add a syncopated arpeggio while preserving voicing and harmonic rhythm.';
const PARAPHRASE =
    'Turn the selected chord clip into a syncopated arp without changing its voicing or harmonic pacing.';

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const runtimeMocks = vi.hoisted(() => ({
    backend: { value: 'webllm' },
    fetch: vi.fn<typeof fetch>(),
    generateWebLlmCompletion: vi.fn<(systemPrompt: string, userMessage: string) => Promise<string>>(),
    transformPlan: { value: (plan: ProviderCall[]) => plan },
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createClip(id: string, trackId: string, name: string): Clip {
    return {
        id,
        trackId,
        name,
        startBeat: 0,
        endBeat: 6,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function createTrack(id: string, name: string, clipId: string): Track {
    return {
        id,
        name,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [createClip(clipId, id, `${name} Phrase`)],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function createProviderPlan(userMessage: string): ProviderCall[] {
    const match = /<project_context>\n(?<contextJson>.+)\n<\/project_context>/u.exec(userMessage);
    const contextJson = match?.groups?.contextJson;
    if (!contextJson) {
        throw new TypeError('Expected serialized project context');
    }
    const context: unknown = JSON.parse(contextJson);
    if (!isRecord(context) || typeof context.projectRevision !== 'string') {
        throw new TypeError('Expected revision-bound project context');
    }
    const capability = context.syncopatedArpeggioCapability;
    if (!isRecord(capability) || capability.baseRevision !== context.projectRevision) {
        throw new TypeError('Expected revision-bound EX-07 capability');
    }
    const allowedAction = capability.allowedAction;
    if (!isRecord(allowedAction) || typeof allowedAction.clipId !== 'string') {
        throw new TypeError('Expected exact selected MIDI clip capability');
    }
    return [
        {
            name: 'arpeggiate',
            arguments: {
                clipId: allowedAction.clipId,
                pattern: allowedAction.pattern,
                rate: allowedAction.rate,
                octaves: allowedAction.octaves,
                gate: allowedAction.gate,
            },
        },
    ];
}

function getHostedUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    if (!isRecord(request) || !isUnknownArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    const userMessage = request.messages.find(
        (message: unknown) => isRecord(message) && message.role === 'user' && typeof message.content === 'string'
    );
    if (!isRecord(userMessage) || typeof userMessage.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return userMessage.content;
}

function useHostedFixture(): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const plan = withWorkflowCapabilitySelection(
            'syncopated-arpeggio',
            runtimeMocks.transformPlan.value(createProviderPlan(getHostedUserMessage(init.body)))
        );
        return Promise.resolve(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                tool_calls: plan.map((call) => ({
                                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                })),
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
    });
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

const sourceNotes = [
    { id: 'c1', pitch: 60, startBeat: 0, duration: 2, velocity: 100, channel: 0 },
    { id: 'e1', pitch: 64, startBeat: 0, duration: 2, velocity: 92, channel: 0 },
    { id: 'g1', pitch: 67, startBeat: 0, duration: 2, velocity: 88, channel: 0 },
    { id: 'f2', pitch: 65, startBeat: 2, duration: 2, velocity: 98, channel: 0 },
    { id: 'a2', pitch: 69, startBeat: 2, duration: 2, velocity: 90, channel: 0 },
    { id: 'c2', pitch: 72, startBeat: 2, duration: 2, velocity: 86, channel: 0 },
    { id: 'g3', pitch: 67, startBeat: 4, duration: 2, velocity: 96, channel: 0 },
    { id: 'b3', pitch: 71, startBeat: 4, duration: 2, velocity: 89, channel: 0 },
    { id: 'd3', pitch: 74, startBeat: 4, duration: 2, velocity: 84, channel: 0 },
];

describe('EX-07 syncopated arpeggio prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.transformPlan.value = (plan) => plan;
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(
                JSON.stringify(
                    withWorkflowCapabilitySelection(
                        'syncopated-arpeggio',
                        runtimeMocks.transformPlan.value(createProviderPlan(userMessage))
                    )
                )
            )
        );
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('EX-07 arpeggio workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({
            tracks: [
                createTrack('track-chords', 'Chords', 'clip-chords'),
                createTrack('track-lead', 'Lead', 'clip-lead'),
            ],
            selectedTrackId: 'track-chords',
            ghostClips: [],
        });
        clipSelectionStore.set({
            ...defaultClipSelectionState,
            selectedClipId: 'clip-chords',
            selectedClipIds: ['clip-chords'],
        });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        midiStore.set({
            notesByClipId: {
                'clip-chords': structuredClone(sourceNotes),
                'clip-lead': [{ id: 'lead', pitch: 76, startBeat: 0, duration: 6, velocity: 80, channel: 0 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearPendingActionConfirmations();
        clearHandlerRegistry();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('EX-07 arpeggio workflow cleanup');
        removeCrdtDoc('root');
    });

    it('routes a semantic paraphrase to the syncopated-arpeggio capability', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(getConfirmationId()).not.toBe('');
    });

    it.each(['webllm', 'hosted'] as const)(
        'adds one guarded offbeat arpeggio through %s while preserving source voicing and chord boundaries',
        async (provider) => {
            if (provider === 'hosted') {
                useHostedFixture();
            }
            const originalChords = structuredClone(midiStore.value?.notesByClipId['clip-chords']);
            const originalLead = structuredClone(midiStore.value?.notesByClipId['clip-lead']);

            await sendChatMessage(PROMPT);

            const confirmationId = getConfirmationId();
            expect(confirmationId).not.toBe('');
            const confirmation = getPendingActionConfirmation(confirmationId);
            expect(confirmation?.actions).toHaveLength(1);
            const action = confirmation?.actions[0];
            expect(action).toMatchObject({
                type: 'arpeggiate',
                payload: {
                    clipId: 'clip-chords',
                    pattern: 'up',
                    rate: 8,
                    octaves: 1,
                    gate: 50,
                    expectedTrackId: 'track-chords',
                    expectedTrackFrozen: false,
                    expectedClipLocked: false,
                    expectedNotes: sourceNotes,
                },
            });
            if (action?.type !== 'arpeggiate' || !action.payload.addedNotes) {
                throw new TypeError('Expected app-materialized arpeggio action');
            }
            const addedNoteIds = action.payload.addedNotes.map((note) => note.id);
            expect(new Set(addedNoteIds).size).toBe(12);
            expect(addedNoteIds.every((id) => id.startsWith('arp-'))).toBe(true);
            const label =
                'Track "Chords" (track-chords), clip "Chords Phrase" (clip-chords): add 12 syncopated offbeat eighth-note arpeggio notes; preserve 9 source notes, absolute voicing, velocities, expression, and harmonic boundaries';
            expect(confirmation?.actionLabels).toEqual([label]);
            expect(confirmation?.affectedIds).toEqual(['track-chords', 'clip-chords', ...addedNoteIds]);
            expect(confirmation?.risk).toEqual({
                level: 'broad-reversible',
                reason: 'This action can change a broad section of the project.',
            });
            expect(confirmation?.protectedUnchanged).toEqual([
                { id: 'clip-lead', name: 'Lead Phrase (unselected)' },
                {
                    id: 'clip-chords:source-notes',
                    name: 'Chords Phrase source voicing, velocities, expression, and harmonic boundaries',
                },
            ]);

            await confirmPendingChatActions({ confirmationId });

            const committed = midiStore.value?.notesByClipId['clip-chords'] ?? [];
            expect(committed.slice(0, sourceNotes.length)).toEqual(originalChords);
            expect(
                committed.slice(sourceNotes.length).map(({ pitch, startBeat, duration, velocity }) => ({
                    pitch,
                    startBeat,
                    duration,
                    velocity,
                }))
            ).toEqual([
                { pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100 },
                { pitch: 64, startBeat: 0.75, duration: 0.25, velocity: 92 },
                { pitch: 67, startBeat: 1.25, duration: 0.25, velocity: 88 },
                { pitch: 60, startBeat: 1.75, duration: 0.25, velocity: 100 },
                { pitch: 65, startBeat: 2.25, duration: 0.25, velocity: 98 },
                { pitch: 69, startBeat: 2.75, duration: 0.25, velocity: 90 },
                { pitch: 72, startBeat: 3.25, duration: 0.25, velocity: 86 },
                { pitch: 65, startBeat: 3.75, duration: 0.25, velocity: 98 },
                { pitch: 67, startBeat: 4.25, duration: 0.25, velocity: 96 },
                { pitch: 71, startBeat: 4.75, duration: 0.25, velocity: 89 },
                { pitch: 74, startBeat: 5.25, duration: 0.25, velocity: 84 },
                { pitch: 67, startBeat: 5.75, duration: 0.25, velocity: 96 },
            ]);
            expect(midiStore.value?.notesByClipId['clip-lead']).toEqual(originalLead);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
                status: 'executed',
                executionMode: 'atomic',
                executedActions: [
                    {
                        actionType: 'arpeggiate',
                        label,
                        affectedIds: ['track-chords', 'clip-chords', ...addedNoteIds],
                        outcome: 'committed',
                    },
                ],
            });
            const receipt = chatStore.value?.messages.find(
                (message) => message.pendingActionConfirmationId === confirmationId
            );
            expect(receipt?.content).toContain(label);
            for (const affectedId of ['track-chords', 'clip-chords', ...addedNoteIds]) {
                expect(receipt?.content).toContain(affectedId);
            }
            expect(receipt?.content).toContain('Protected unchanged:');

            await undo();
            expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(originalChords);
            await redo();
            expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(committed);
            expect(midiStore.value?.notesByClipId['clip-lead']).toEqual(originalLead);
        }
    );

    it('rejects provider target or policy enlargement before confirmation', async () => {
        const original = structuredClone(midiStore.value?.notesByClipId);
        runtimeMocks.transformPlan.value = (plan) => [
            {
                ...plan[0]!,
                arguments: { ...plan[0]!.arguments, clipId: 'clip-lead', gate: 100 },
            },
        ];

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(midiStore.value?.notesByClipId).toEqual(original);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects stale freeze or note state atomically before writing a receipt or history entry', async () => {
        const original = structuredClone(midiStore.value?.notesByClipId['clip-chords']);
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        expect(confirmationId).not.toBe('');
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-chords' ? { ...track, frozen: true } : track
            ),
        });

        const result = await confirmPendingChatActions({ confirmationId });

        expect(result.status).toBe('failed');
        expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(original);
        expect(undoStore.value?.past).toEqual([]);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({ status: 'failed' });
    });

    it('keeps grouped undo and redo retryable when a collaborator changes the clip or freeze state', async () => {
        const original = structuredClone(midiStore.value?.notesByClipId['clip-chords']) ?? [];
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        await confirmPendingChatActions({ confirmationId });
        const committed = structuredClone(midiStore.value?.notesByClipId['clip-chords']) ?? [];
        const collaboratorNote = {
            id: 'collaborator-note',
            pitch: 79,
            startBeat: 5.5,
            duration: 0.25,
            velocity: 70,
            channel: 0,
        };
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'clip-chords': [...committed, collaboratorNote],
            },
        });

        await undo();
        expect(midiStore.value?.notesByClipId['clip-chords']).toEqual([...committed, collaboratorNote]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);

        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { ...midiStore.value!.notesByClipId, 'clip-chords': committed },
        });
        await undo();
        expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(original);
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-chords' ? { ...track, frozen: true } : track
            ),
        });
        await redo();
        expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(original);
        expect(undoStore.value?.future).toHaveLength(1);

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-chords' ? { ...track, frozen: false } : track
            ),
        });
        await redo();
        expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(committed);
    });

    it('refuses duplicate generation after the first app-owned arpeggio changes the note topology', async () => {
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        await confirmPendingChatActions({ confirmationId });
        const committed = structuredClone(midiStore.value?.notesByClipId['clip-chords']);
        clearPendingActionConfirmations();
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(midiStore.value?.notesByClipId['clip-chords']).toEqual(committed);
        expect(undoStore.value?.past).toHaveLength(1);
    });
});
