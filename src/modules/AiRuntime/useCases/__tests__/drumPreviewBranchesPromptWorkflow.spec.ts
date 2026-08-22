import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { canMutateBranchMetadata } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { branchStore, MAIN_BRANCH_ID } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    DOC_BRANCHES,
    getCrdtDoc,
    getCrdtDocIds,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';
import { type AppAction } from '#/utils/handlerContract';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { getDrumPreviewBranchesPromptScope } from '../agentReference/getDrumPreviewBranchesPromptScope';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { withWorkflowCapabilitySelection } from './workflowCapabilitySelectionFixture';

const PROMPT =
    'For one eight-bar section, create three drum-arrangement candidates on separate preview branches while preserving the kick pattern and varying only snare and hi-hat programming.';
const PARAPHRASE =
    'Make three alternate eight-bar drum previews on isolated branches; keep the kick identical and change only snare and hats.';

type ProviderCall = { name: string; arguments: Record<string, unknown> };
type CreatePreviewAction = Extract<AppAction, { type: 'createDrumPreviewBranches' }>;

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn<(systemPrompt: string, userMessage: string) => Promise<string>>(),
        transformPlan: { value: (plan: ProviderCall[]) => plan },
    };
});

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function createClip(id: string, trackId: string, name: string): Clip {
    return {
        id,
        trackId,
        name,
        startBeat: 0,
        endBeat: 32,
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
        clips: [createClip(clipId, id, `${name} Pattern`)],
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

function getProviderUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    if (!isRecord(request) || !isUnknownArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    const userMessage = request.messages.find(
        (message) => isRecord(message) && message.role === 'user' && typeof message.content === 'string'
    );
    if (!isRecord(userMessage) || typeof userMessage.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return userMessage.content;
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
    const capability = context.drumPreviewBranchesCapability;
    if (!isRecord(capability) || capability.baseRevision !== context.projectRevision) {
        throw new TypeError('Expected revision-bound EX-05 capability');
    }
    const action = capability.allowedAction;
    if (
        !isRecord(action) ||
        action.type !== 'createDrumPreviewBranches' ||
        typeof action.sectionId !== 'string' ||
        action.candidateCount !== 3 ||
        !isUnknownArray(action.varyingRoles) ||
        action.varyingRoles[0] !== 'snare' ||
        action.varyingRoles[1] !== 'hi-hat'
    ) {
        throw new TypeError('Expected exact app-owned EX-05 planning scope');
    }
    return [
        {
            name: 'createDrumPreviewBranches',
            arguments: {
                sectionId: action.sectionId,
                candidateCount: action.candidateCount,
                varyingRoles: [action.varyingRoles[0], action.varyingRoles[1]],
            },
        },
    ];
}

function useHostedFixture(): void {
    runtimeMocks.backend.value = 'cloud';
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        const plan = withWorkflowCapabilitySelection(
            'drum-preview-branches',
            runtimeMocks.transformPlan.value(createProviderPlan(getProviderUserMessage(init.body)))
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

function getPreviewAction(confirmationId: string): CreatePreviewAction {
    const action = getPendingActionConfirmation(confirmationId)?.actions[0];
    if (action?.type !== 'createDrumPreviewBranches') {
        throw new TypeError('Expected one materialized drum preview branch action');
    }
    return action;
}

function readPlainDoc(docId: string): Record<string, unknown> {
    const doc = getCrdtDoc(docId);
    if (!doc) {
        throw new TypeError(`Expected CRDT document ${docId}`);
    }
    const parsed: unknown = JSON.parse(JSON.stringify(doc));
    if (!isRecord(parsed)) {
        throw new TypeError(`Expected object document ${docId}`);
    }
    return parsed;
}

function readNotes(doc: Record<string, unknown>, clipId: string): unknown[] {
    const midi = doc.midi;
    if (!isRecord(midi) || !isRecord(midi.notesByClipId)) {
        throw new TypeError('Expected MIDI state in CRDT document');
    }
    const notes = midi.notesByClipId[clipId];
    if (!Array.isArray(notes)) {
        throw new TypeError(`Expected MIDI notes for ${clipId}`);
    }
    return structuredClone(notes);
}

function replaceNotes(doc: Record<string, unknown>, clipId: string, notes: unknown[]): void {
    const midi = doc.midi;
    if (!isRecord(midi) || !isRecord(midi.notesByClipId)) {
        throw new TypeError('Expected mutable plain MIDI state');
    }
    midi.notesByClipId[clipId] = structuredClone(notes);
}

function expectedLabel(action: CreatePreviewAction): string {
    const candidates = action.payload.candidates
        .map(
            (candidate) =>
                `"${candidate.branchName}" (${candidate.branchId}, ${candidate.rootDocId}, ${candidate.recipe})`
        )
        .join(', ');
    return `Create exactly three preview branches for "${action.payload.sectionName}" (${action.payload.sectionId}, beats ${String(action.payload.sectionStartBeat)}–${String(action.payload.sectionEndBeat)}): ${candidates}; preserve Kick track "${action.payload.kick.trackName}" (${action.payload.kick.trackId}) clip "${action.payload.kick.clipName}" (${action.payload.kick.clipId}) exactly; vary only Snare clip "${action.payload.snare.clipName}" (${action.payload.snare.clipId}) and Hi-Hat clip "${action.payload.hiHat.clipName}" (${action.payload.hiHat.clipId}); keep the source branch active and unchanged`;
}

function expectedAffectedIds(action: CreatePreviewAction): string[] {
    return action.payload.candidates.flatMap((candidate) => [
        candidate.branchId,
        candidate.rootDocId,
        `${candidate.branchId}:${action.payload.snare.clipId}`,
        `${candidate.branchId}:${action.payload.hiHat.clipId}`,
    ]);
}

function setCollaborationAuthority({ isEnabled, isHost }: { isEnabled: boolean; isHost: boolean }): void {
    collaborationStore.set({
        isEnabled,
        sessionId: isEnabled ? 'session-ex05' : null,
        localPeerId: isEnabled ? 'peer-ex05' : null,
        localName: 'EX-05 Test',
        localColor: '#ffffff',
        isHost,
        peers: [],
        connectionStatus: isEnabled ? 'connected' : 'disconnected',
        error: null,
        quarantinedPeerIds: [],
    });
}

describe('EX-05 drum preview-branch prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.transformPlan.value = (plan) => plan;
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(
                JSON.stringify(
                    withWorkflowCapabilitySelection(
                        'drum-preview-branches',
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
        resetCrdtProjectAuthority('EX-05 drum preview workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getDrumPreviewBranchHandlers({ canMutateBranchMetadata }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setCollaborationAuthority({ isEnabled: false, isHost: false });
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({
            tracks: [
                createTrack('track-kick', 'Kick', 'clip-kick'),
                createTrack('track-snare', 'Snare', 'clip-snare'),
                createTrack('track-hats', 'Hi-Hat', 'clip-hats'),
                createTrack('track-bass', 'Bass', 'clip-bass'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        markerStore.set({
            markers: [],
            sections: [
                {
                    id: 'section-eight-bars',
                    name: 'Verse One',
                    startBeat: 0,
                    endBeat: 32,
                    color: '#ffffff',
                },
            ],
        });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        });
        midiStore.set({
            notesByClipId: {
                'clip-kick': Array.from({ length: 8 }, (_, index) => ({
                    id: `kick-${String(index + 1)}`,
                    pitch: 36,
                    startBeat: index * 4,
                    duration: 0.25,
                    velocity: 112,
                })),
                'clip-snare': Array.from({ length: 8 }, (_, index) => ({
                    id: `snare-${String(index + 1)}`,
                    pitch: 38,
                    startBeat: index * 4 + 2,
                    duration: 0.25,
                    velocity: 104,
                })),
                'clip-hats': Array.from({ length: 32 }, (_, index) => ({
                    id: `hat-${String(index + 1)}`,
                    pitch: 42,
                    startBeat: index,
                    duration: 0.125,
                    velocity: 84,
                })),
                'clip-bass': [{ id: 'bass-1', pitch: 36, startBeat: 0, duration: 4, velocity: 96 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        resetAiWorkflowCommandPreflightFixture();
        clearPendingActionConfirmations();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('EX-05 drum preview workflow cleanup');
        await cloudSession.clear();
        vi.unstubAllGlobals();
    });

    it('routes a semantic paraphrase to the drum-preview capability', async () => {
        await sendChatMessage(PARAPHRASE);
        expect(getConfirmationId()).not.toBe('');
    });

    it.each(['webllm', 'hosted'] as const)(
        'creates three isolated app-owned candidates through the %s provider and round-trips one guarded history entry',
        async (provider) => {
            if (provider === 'hosted') {
                useHostedFixture();
            }
            const scope = getDrumPreviewBranchesPromptScope(getProjectContext(), 'revision-test');
            expect(scope).toMatchObject({
                status: 'request',
                capability: {
                    baseRevision: 'revision-test',
                    allowedAction: {
                        type: 'createDrumPreviewBranches',
                        sectionId: 'section-eight-bars',
                        candidateCount: 3,
                        varyingRoles: ['snare', 'hi-hat'],
                    },
                },
            });
            const sourceDocBefore = readPlainDoc('root');
            const sourceDocIdsBefore = getCrdtDocIds().toSorted();

            await sendChatMessage(PROMPT);

            const confirmationId = getConfirmationId();
            expect(confirmationId).not.toBe('');
            const confirmation = getPendingActionConfirmation(confirmationId);
            const action = getPreviewAction(confirmationId);
            expect(action.payload).toMatchObject({
                expectedSourceBranchId: MAIN_BRANCH_ID,
                sectionId: 'section-eight-bars',
                sectionName: 'Verse One',
                sectionStartBeat: 0,
                sectionEndBeat: 32,
                candidateCount: 3,
                varyingRoles: ['snare', 'hi-hat'],
                kick: { trackId: 'track-kick', clipId: 'clip-kick', expectedTrackFrozen: false },
                snare: { trackId: 'track-snare', clipId: 'clip-snare', expectedTrackFrozen: false },
                hiHat: { trackId: 'track-hats', clipId: 'clip-hats', expectedTrackFrozen: false },
            });
            expect(action.payload.candidates.map(({ recipe }) => recipe)).toEqual([
                'ghost-note-pocket',
                'half-time-space',
                'syncopated-hats',
            ]);
            expect(new Set(action.payload.candidates.map(({ branchId }) => branchId))).toHaveProperty('size', 3);
            expect(
                action.payload.candidates.every(({ branchId, rootDocId }) => rootDocId === `branch_${branchId}`)
            ).toBe(true);
            const label = expectedLabel(action);
            const affectedIds = expectedAffectedIds(action);
            expect(confirmation?.actionLabels).toEqual([label]);
            expect(confirmation?.affectedIds).toEqual(affectedIds);
            expect(confirmation?.risk).toEqual({
                level: 'broad-reversible',
                reason: 'This action can change a broad section of the project.',
            });
            expect(confirmation?.protectedUnchanged).toEqual(
                expect.arrayContaining([
                    { id: 'track-kick', name: 'Kick (unchanged in every candidate)' },
                    { id: 'clip-kick', name: 'Kick Pattern kick pattern (exactly preserved)' },
                    { id: 'track-bass', name: 'Bass (unchanged in every candidate)' },
                    {
                        id: 'track-snare:non-programming',
                        name: 'Snare routing, devices, automation, and track state',
                    },
                    {
                        id: 'track-hats:non-programming',
                        name: 'Hi-Hat routing, devices, automation, and track state',
                    },
                ])
            );
            expect(branchStore.value?.branches).toHaveLength(1);
            expect(branchStore.value?.activeBranchId).toBe(MAIN_BRANCH_ID);
            expect(getCrdtDocIds().toSorted()).toEqual(sourceDocIdsBefore);
            expect(readPlainDoc('root')).toEqual(sourceDocBefore);

            await confirmPendingChatActions({ confirmationId });

            expect(branchStore.value?.activeBranchId).toBe(MAIN_BRANCH_ID);
            expect(branchStore.value?.branches).toHaveLength(4);
            expect(readPlainDoc('root')).toEqual(sourceDocBefore);
            const candidateDocsAfterCommit = new Map<string, Record<string, unknown>>();
            const candidateProgramming: string[] = [];
            for (const candidate of action.payload.candidates) {
                const candidateDoc = readPlainDoc(candidate.rootDocId);
                candidateDocsAfterCommit.set(candidate.rootDocId, structuredClone(candidateDoc));
                expect(readNotes(candidateDoc, 'clip-kick')).toEqual(readNotes(sourceDocBefore, 'clip-kick'));
                expect(readNotes(candidateDoc, 'clip-bass')).toEqual(readNotes(sourceDocBefore, 'clip-bass'));
                expect(readNotes(candidateDoc, 'clip-snare')).toEqual(candidate.snareNotes);
                expect(readNotes(candidateDoc, 'clip-hats')).toEqual(candidate.hiHatNotes);
                candidateProgramming.push(
                    JSON.stringify([readNotes(candidateDoc, 'clip-snare'), readNotes(candidateDoc, 'clip-hats')])
                );
                replaceNotes(candidateDoc, 'clip-snare', readNotes(sourceDocBefore, 'clip-snare'));
                replaceNotes(candidateDoc, 'clip-hats', readNotes(sourceDocBefore, 'clip-hats'));
                expect(candidateDoc).toEqual(sourceDocBefore);
            }
            expect(new Set(candidateProgramming)).toHaveProperty('size', 3);
            expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
                status: 'executed',
                executionMode: 'atomic',
                executedActions: [
                    expect.objectContaining({
                        actionType: 'createDrumPreviewBranches',
                        label,
                        affectedIds,
                        outcome: 'committed',
                    }),
                ],
            });
            const receipt = chatStore.value?.messages.find(
                (message) => message.pendingActionConfirmationId === confirmationId
            );
            expect(receipt?.content).toContain(label);
            expect(receipt?.content).toContain(`Affected IDs: ${affectedIds.join(', ')}`);
            expect(receipt?.content).toContain('Protected unchanged:');
            expect(undoStore.value?.past).toHaveLength(1);

            await undo();

            expect(branchStore.value?.branches).toHaveLength(1);
            expect(branchStore.value?.activeBranchId).toBe(MAIN_BRANCH_ID);
            expect(getCrdtDocIds().toSorted()).toEqual(sourceDocIdsBefore);
            expect(readPlainDoc('root')).toEqual(sourceDocBefore);
            expect(undoStore.value?.future).toHaveLength(1);

            await redo();

            expect(branchStore.value?.activeBranchId).toBe(MAIN_BRANCH_ID);
            expect(branchStore.value?.branches).toHaveLength(4);
            expect(new Set(branchStore.value?.branches.map(({ branchId }) => branchId))).toHaveProperty('size', 4);
            expect(readPlainDoc('root')).toEqual(sourceDocBefore);
            for (const candidate of action.payload.candidates) {
                expect(readPlainDoc(candidate.rootDocId)).toEqual(candidateDocsAfterCommit.get(candidate.rootDocId));
            }
        }
    );

    it.each([
        ['omits the candidate action', () => []],
        ['duplicates the candidate action', (plan: ProviderCall[]) => [...plan, ...plan]],
        [
            'changes the exact section',
            (plan: ProviderCall[]) =>
                plan.map((call) => ({ ...call, arguments: { ...call.arguments, sectionId: 'section-other' } })),
        ],
        [
            'reorders the mutable roles',
            (plan: ProviderCall[]) =>
                plan.map((call) => ({
                    ...call,
                    arguments: { ...call.arguments, varyingRoles: ['hi-hat', 'snare'] },
                })),
        ],
    ] as const)('rejects a provider plan that %s', async (_name, transform) => {
        runtimeMocks.transformPlan.value = transform;

        await sendChatMessage(PROMPT);

        expect(getConfirmationId()).toBe('');
        expect(branchStore.value?.branches).toHaveLength(1);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('rejects a stale source edit before creating any candidate document or receipt', async () => {
        const sourceDocIdsBefore = getCrdtDocIds().toSorted();
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-snare'
                    ? { ...track, frozen: true, freezeState: { status: 'frozen', renderId: 'collaborator-render' } }
                    : track
            ),
        });

        await confirmPendingChatActions({ confirmationId });

        expect(getPendingActionConfirmation(confirmationId)?.status).toBe('failed');
        expect(getCrdtDocIds().toSorted()).toEqual(sourceDocIdsBefore);
        expect(branchStore.value?.branches).toHaveLength(1);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId === confirmationId)?.content
        ).not.toContain('Outcome: committed');
    });

    it('rejects preview-branch creation when the local collaboration peer is not the host', async () => {
        setCollaborationAuthority({ isEnabled: true, isHost: false });
        const sourceDocIdsBefore = getCrdtDocIds().toSorted();
        const sourceBranchesBefore = structuredClone(branchStore.value);

        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const result = await confirmPendingChatActions({ confirmationId });

        expect(result).toMatchObject({
            status: 'failed',
            reason: expect.stringContaining('Only the collaboration host may change preview-branch metadata'),
        });
        expect(getPendingActionConfirmation(confirmationId)?.status).toBe('failed');
        expect(getCrdtDocIds().toSorted()).toEqual(sourceDocIdsBefore);
        expect(branchStore.value).toEqual(sourceBranchesBefore);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId === confirmationId)?.content
        ).not.toContain('Outcome: committed');
    });

    it('commits against the exact host-owned branch metadata delta during an active collaboration projection', async () => {
        setCollaborationAuthority({ isEnabled: true, isHost: true });
        createCrdtDoc(DOC_BRANCHES);
        mutateCrdtDoc<{ branches?: unknown }>({
            id: DOC_BRANCHES,
            changeFn: (draft) => {
                draft.branches = structuredClone(branchStore.value?.branches ?? []);
            },
        });
        const unsubscribe = branchStore.subscribe((state) => {
            mutateCrdtDoc<{ branches?: unknown }>({
                id: DOC_BRANCHES,
                changeFn: (draft) => {
                    draft.branches = structuredClone(state?.branches ?? []);
                },
            });
        });
        const changedDocIds: string[] = [];
        const unsubscribeCrdt = subscribeToCrdtChanges((docId) => {
            if (docId) {
                changedDocIds.push(docId);
            }
        });

        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const action = getPreviewAction(confirmationId);
        const result = await confirmPendingChatActions({ confirmationId });

        expect(result).toEqual({ status: 'executed' });
        expect(branchStore.value?.branches).toHaveLength(4);
        expect(readPlainDoc(DOC_BRANCHES).branches).toHaveLength(4);
        expect(changedDocIds).toEqual(
            expect.arrayContaining(action.payload.candidates.map(({ rootDocId }) => rootDocId))
        );
        expect(undoStore.value?.past).toHaveLength(1);
        unsubscribeCrdt();
        unsubscribe();
    });

    it('preserves all three candidates and the whole undo entry when a collaborator edits one branch', async () => {
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        const action = getPreviewAction(confirmationId);
        await confirmPendingChatActions({ confirmationId });
        const editedBranch = action.payload.candidates[0]!;
        mutateCrdtDoc<Record<string, unknown>>({
            id: editedBranch.rootDocId,
            changeFn: (draft) => {
                draft.collaboratorMarker = 'keep';
            },
        });
        const branchStateBeforeUndo = structuredClone(branchStore.value);
        const docIdsBeforeUndo = getCrdtDocIds().toSorted();

        await undo();

        expect(branchStore.value).toEqual(branchStateBeforeUndo);
        expect(getCrdtDocIds().toSorted()).toEqual(docIdsBeforeUndo);
        expect(readPlainDoc(editedBranch.rootDocId)).toMatchObject({ collaboratorMarker: 'keep' });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('keeps the committed candidates and whole history entry when a collaboration joiner attempts undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmationId = getConfirmationId();
        await confirmPendingChatActions({ confirmationId });
        const branchStateBeforeUndo = structuredClone(branchStore.value);
        const docIdsBeforeUndo = getCrdtDocIds().toSorted();
        setCollaborationAuthority({ isEnabled: true, isHost: false });

        await undo();

        expect(branchStore.value).toEqual(branchStateBeforeUndo);
        expect(getCrdtDocIds().toSorted()).toEqual(docIdsBeforeUndo);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });
});
