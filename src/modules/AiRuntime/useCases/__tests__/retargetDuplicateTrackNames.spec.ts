import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { createAcceptanceFixtureLifetime } from '../../__tests__/acceptanceFixtureLifetime';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { readNamedTracks } from '../lastCommitContinuation/readNamedTracks';
import { type planPromptActions } from '../planPromptActions';
import { readChatThreadContext } from '../readChatThreadContext';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { literalMetricIntakeTurn } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

/**
 * #6795: a last-commit re-target that names a stretch several same-named tracks share asks which one
 * by order among them, and the answer re-targets only that track. Rows run the chat route against the
 * real stores, Command and CRDT document, with only the provider scripted.
 */

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const VOCALS_DOWN_3_DB: ProviderCall = { name: 'setTrackGain', arguments: { trackId: 'track-vocals', deltaDb: -3 } };

const runtimeMocks = vi.hoisted(() => ({
    // Device-chain topology stays on the real runtime path; only the per-parameter write to a live
    // node is stubbed, because the stubbed AudioParam objects carry no schedulable timeline.
    updateDeviceParam: vi.fn(),
    generateWebLlmCompletion: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

/**
 * The live device chain is built with real Web Audio nodes. `src/setupTests.ts` stubs an
 * AudioContext with only the nodes the engine constructor needs, so the filter and panner nodes an
 * inserted device asks for are added here, exactly as the other device-committing AI workflow
 * suites do.
 */
vi.hoisted(() => {
    const OriginalAudioContext = globalThis.AudioContext;
    const createAudioParam = (value: number) => ({
        value,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
    });
    const createNode = () => ({
        connect: (destination: unknown) => destination,
        disconnect: () => undefined,
    });
    function AudioContextWithDeviceNodes(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return Object.assign(context, {
            currentTime: 0,
            createStereoPanner: () => ({ ...createNode(), pan: createAudioParam(0) }),
            createBiquadFilter: () => ({
                ...createNode(),
                type: 'lowpass',
                frequency: createAudioParam(350),
                Q: createAudioParam(1),
                gain: createAudioParam(0),
                detune: createAudioParam(0),
            }),
            createDynamicsCompressor: () => ({
                ...createNode(),
                threshold: createAudioParam(-24),
                knee: createAudioParam(30),
                ratio: createAudioParam(12),
                attack: createAudioParam(0.003),
                release: createAudioParam(0.25),
                reduction: 0,
            }),
            createWaveShaper: () => ({ ...createNode(), curve: null, oversample: 'none' }),
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        writable: true,
        value: AudioContextWithDeviceNodes,
    });
});

/**
 * Tearing a live strip down closes its meter worklet port, which the jsdom worklet stub in
 * `src/setupTests.ts` does not provide.
 */
vi.hoisted(() => {
    const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;
    class AudioWorkletNodeWithClosablePort extends OriginalAudioWorkletNode {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
            super(context, name, options);
            if (typeof this.port.close !== 'function') {
                Object.defineProperty(this.port, 'close', { configurable: true, value: () => undefined });
            }
        }
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        writable: true,
        value: AudioWorkletNodeWithClosablePort,
    });
});

const scriptState = { requestTurn: 0, planningTurn: 0 };
const chatPlanning = vi.hoisted(() => ({
    last: null as Awaited<ReturnType<typeof planPromptActions>>['result'] | null,
}));

vi.mock('../planPromptActions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../planPromptActions')>();
    return {
        ...actual,
        planPromptActions: async (input: Parameters<typeof actual.planPromptActions>[0]) => {
            const planned = await actual.planPromptActions(input);
            chatPlanning.last = planned.result;
            return planned;
        },
    };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({ getBackendChain: () => ['webllm'] }));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({ resolveBackend: () => 'webllm' }));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: runtimeMocks.updateDeviceParam,
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
}));

const notificationEventBus = { emit: vi.fn(() => Promise.resolve()), on: vi.fn(() => () => undefined) };

function createTrack(id: string, name: string): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
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

function getTrack(id: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
    if (!track) {
        throw new Error(`Expected track ${id}`);
    }
    return track;
}

function decibelsOf(trackId: string): number {
    return Math.round(20 * Math.log10(getTrack(trackId).gain) * 1000) / 1000;
}

function asCommandBatchProposal(calls: readonly ProviderCall[], refines?: string): ProviderCall {
    const proposal: ProviderCall = {
        name: 'command.batch.propose',
        arguments: {
            commands: calls.map((call) => ({ name: call.name, arguments: call.arguments })),
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Apply the exact requested mix changes.',
                constraints: [],
                scope: {
                    targetIds: [
                        ...new Set(
                            calls.flatMap((call) =>
                                [call.arguments.trackId, call.arguments.busId].filter(
                                    (id): id is string => typeof id === 'string'
                                )
                            )
                        ),
                    ],
                    targetRanges: [],
                    protectedTargetIds: [],
                    protectedRanges: [],
                },
                capabilityIds: [...new Set(calls.map((call) => call.name))],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Validate exact track identities and values.'],
                stoppingConditions: ['Stop if any target precondition fails.'],
            },
        },
    };
    if (refines !== undefined) {
        proposal.arguments.refines = refines;
    }
    return proposal;
}

/**
 * The first provider turn admits the whole request; subsequent planning attempts discover command
 * schemas and propose. The attempts take the plans in order, and later attempts repeat the last plan.
 */
function scriptProvider(
    plans: ReadonlyArray<readonly ProviderCall[]>,
    refinement?: { planIndex: number; id: () => string }
): void {
    scriptState.requestTurn = 0;
    scriptState.planningTurn = 0;
    runtimeMocks.generateWebLlmCompletion.mockImplementation(async (systemPrompt: string, userMessage: string) => {
        if (scriptState.requestTurn === 0) {
            scriptState.requestTurn += 1;
            return JSON.stringify(literalMetricIntakeTurn(userMessage, systemPrompt));
        }
        scriptState.requestTurn += 1;
        const planIndex = Math.min(Math.floor(scriptState.planningTurn / 2), plans.length - 1);
        const plan = plans[planIndex];
        if (plan === undefined) {
            throw new Error('Expected a scripted planning run.');
        }
        if (scriptState.planningTurn % 2 === 0) {
            scriptState.planningTurn += 1;
            const names = [...new Set(plan.map((call) => call.name))];
            return JSON.stringify([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }]);
        }
        scriptState.planningTurn += 1;
        return JSON.stringify([
            asCommandBatchProposal(plan, refinement?.planIndex === planIndex ? refinement.id() : undefined),
        ]);
    });
}

async function sendChatMessage(prompt: string, options?: Parameters<typeof sendChatMessageWithoutDocumentFlush>[1]) {
    flushAutomergeStorageWrites();
    // Each chat request has its own required first-turn intake; planning corrections stay scripted in sequence.
    scriptState.requestTurn = 0;
    chatPlanning.last = null;
    await sendChatMessageWithoutDocumentFlush(prompt, options);
}
function providerCallCount(): number {
    return runtimeMocks.generateWebLlmCompletion.mock.calls.length;
}

function lastAssistantMessage() {
    return chatStore.value?.messages.findLast((message) => message.role === 'assistant');
}

function proposedIds(): string[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? [])
        .filter((confirmation) => confirmation.status === 'proposed')
        .map((confirmation) => confirmation.id);
}

/** The newest commit's undo entries, as the undo history holds them applied. */
function newestCommittedActions() {
    const past = undoHistoryStore.value?.past ?? [];
    const groupId = past.at(-1)?.groupId;
    return past
        .filter((entry) => entry.groupId === groupId)
        .map((entry) => (entry.kind === 'action' ? entry.action : null));
}

/** Commits "turn Vocals down 3 dB" through the chat, which the risk policy applies directly. */
async function commitVocalsDown3Db(): Promise<void> {
    await sendChatMessage('Turn Vocals down 3 dB');
    expect(proposedIds()).toEqual([]);
    expect(decibelsOf('track-vocals')).toBe(-3);
    expect(readChatThreadContext()?.lastCommit?.standing).toBe('standing');
}

/** Confirms the card a request left waiting, when the risk policy put it to the user rather than committing it. */
async function confirmIfProposed(): Promise<void> {
    const [pendingId] = proposedIds();
    if (pendingId !== undefined) {
        await expect(confirmPendingChatActions({ confirmationId: pendingId })).resolves.toEqual({ status: 'executed' });
    }
}

const fixtureLifetime = createAcceptanceFixtureLifetime();

type NamedTrack = readonly [id: string, name: string];

const TWO_LEADS: ReadonlyArray<NamedTrack> = [
    ['track-vocals', 'Vocals'],
    ['lead-a', 'Lead'],
    ['track-bass', 'Bass'],
    ['lead-b', 'Lead'],
    ['track-keys', 'Keys'],
];

const THREE_LEADS: ReadonlyArray<NamedTrack> = [...TWO_LEADS, ['lead-c', 'Lead']];

const FOUR_LEADS: ReadonlyArray<NamedTrack> = [...THREE_LEADS, ['lead-d', 'Lead']];

function setProjectTracks(tracks: ReadonlyArray<NamedTrack>): void {
    trackStore.set({
        tracks: tracks.map(([id, name]) => createTrack(id, name)),
        selectedTrackId: null,
        ghostClips: [],
    });
}

/** The track ids the newest committed batch moved. */
function newestCommittedTrackIds(): string[] {
    return newestCommittedActions().flatMap((action) => {
        const payload: Record<string, unknown> = action?.payload ?? {};
        return typeof payload.trackId === 'string' ? [payload.trackId] : [];
    });
}

async function askAfterVocalsCommit(prompt: string): Promise<string> {
    scriptProvider([[VOCALS_DOWN_3_DB]]);
    await commitVocalsDown3Db();
    await sendChatMessage(prompt);
    return lastAssistantMessage()?.content ?? '';
}

describe('re-targeting a last commit onto same-named tracks', () => {
    beforeEach(() => fixtureLifetime.drain());
    beforeEach(() =>
        fixtureLifetime.track(async () => {
            configureAiWorkflowCommandPreflightFixture();
            vi.clearAllMocks();
            configureAutomergeStoragePort(null);
            resetCrdtProjectAuthority('retarget duplicate names test');
            removeCrdtDoc('root');
            createCrdtDoc('root');
            registerCrdtStorageRuntime();
            clearHandlerRegistry();
            registerHandlerMap(getArrangementHandlers());
            clearUndoHistory();
            resetActionReplayAuthority();
            setActionHistoryMetadataPort({
                record: () => [],
                markReverted: () => ({ status: 'unavailable' as const }),
                clear: () => undefined,
            });
            clearAiHistory();
            agentRunLifecycle.clear();
            clearPendingActionConfirmations();
            setArrangementEventBus({ emit: () => Promise.resolve() });
            setNotificationEventBus(notificationEventBus);
            macroStore.set({ macros: [], recording: false, currentRecording: [] });
            setProjectTracks(TWO_LEADS);
            automationStore.set({ lanes: [] });
            transportStore.set(defaultTransportState);
            chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        })
    );
    afterEach(() =>
        fixtureLifetime.cleanup(async () => {
            vi.restoreAllMocks();
            setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
            clearUndoHistory();
            resetAiWorkflowCommandPreflightFixture();
            resetActionReplayAuthority();
            clearHandlerRegistry();
            clearAiHistory();
            agentRunLifecycle.clear();
            clearPendingActionConfirmations();
            trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
            automationStore.set({ lanes: [] });
            transportStore.set(defaultTransportState);
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            await Promise.resolve();
        })
    );

    it('asks which of two same-named tracks by order among them, naming both', async () => {
        const reply = await askAfterVocalsCommit('Lead too');

        expect(reply).toContain(
            'Which track should take the last change: the first Lead or the second Lead, counting from the top of the track list?'
        );
    });

    it('orders three same-named tracks', async () => {
        setProjectTracks(THREE_LEADS);

        const reply = await askAfterVocalsCommit('Lead too');

        expect(reply).toContain(
            'the first Lead, the second Lead or the third Lead, counting from the top of the track list?'
        );
    });

    it('keeps the wording for tracks whose names differ', async () => {
        setProjectTracks([
            ['track-vocals', 'Vocals'],
            ['lead-guitar', 'Lead Guitar'],
            ['guitar-lead', 'Guitar Lead'],
        ]);

        const reply = await askAfterVocalsCommit('Lead Guitar Lead too');

        expect(reply).toContain('Which track should take the last change: Lead Guitar or Guitar Lead?');
        expect(reply).not.toContain('counting');
    });

    it.each<readonly [prompt: string, expected: readonly string[]]>([
        ['the second Lead too', ['lead-b']],
        ['the first Lead too', ['lead-a']],
        ['first lead too', ['lead-a']],
        ['Bass and the second Lead too', ['track-bass', 'lead-b']],
        ['the first Lead and the second Lead too', ['lead-a', 'lead-b']],
    ])('answering "%s" re-targets exactly the listed tracks', async (prompt, expected) => {
        scriptProvider([[VOCALS_DOWN_3_DB]]);
        await commitVocalsDown3Db();

        await sendChatMessage(prompt);
        await confirmIfProposed();

        expect(newestCommittedTrackIds().toSorted()).toEqual([...expected].toSorted());
    });

    it('asks which Lead again for an ordinal past the Leads, changing nothing', async () => {
        scriptProvider([[VOCALS_DOWN_3_DB]]);
        await commitVocalsDown3Db();
        const commits = undoHistoryStore.value?.past.length ?? 0;
        const lastCommit = readChatThreadContext()?.lastCommit;

        await sendChatMessage('the third Lead too');

        expect(lastAssistantMessage()?.content).toContain(
            'the first Lead or the second Lead, counting from the top of the track list?'
        );
        expect(proposedIds()).toEqual([]);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(commits);
        expect(readChatThreadContext()?.lastCommit).toEqual(lastCommit);
        expect(decibelsOf('lead-a')).toBe(0);
        expect(decibelsOf('lead-b')).toBe(0);
    });

    const SECOND_LEAD_TRACKS: ReadonlyArray<NamedTrack> = [
        ['track-vocals', 'Vocals'],
        ['lead-a', 'Lead'],
        ['lead-b', 'Lead'],
        ['second-lead', 'Second Lead'],
    ];
    const SECOND_TRACKS: ReadonlyArray<NamedTrack> = [...TWO_LEADS, ['second', 'Second']];

    /** The ask to rename: no ordinal is offered or read where its words are also another track's name. */
    it.each<readonly [prompt: string, tracks: ReadonlyArray<NamedTrack>]>([
        ['Lead too', SECOND_LEAD_TRACKS],
        ['the second Lead too', SECOND_LEAD_TRACKS],
        ['Second Lead too', SECOND_TRACKS],
        ['First Lead too', [...TWO_LEADS, ['first-lead', 'First Lead']]],
    ])('"%s" asks to rename same-named tracks and changes nothing', async (prompt, tracks) => {
        setProjectTracks(tracks);
        scriptProvider([[VOCALS_DOWN_3_DB]]);
        await commitVocalsDown3Db();
        const commits = undoHistoryStore.value?.past.length ?? 0;
        const lastCommit = readChatThreadContext()?.lastCommit;

        await sendChatMessage(prompt);

        expect(lastAssistantMessage()?.content).toContain(
            'Tracks named Lead cannot be told apart by order here; rename one of them and ask again.'
        );
        expect(proposedIds()).toEqual([]);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(commits);
        expect(readChatThreadContext()?.lastCommit).toEqual(lastCommit);
        for (const [id] of tracks.filter(([trackId]) => trackId !== 'track-vocals')) {
            expect(decibelsOf(id)).toBe(0);
        }
    });

    it('labels a mixed question by each track order among its own name, not by its place in the list', async () => {
        setProjectTracks([
            ['track-vocals', 'Vocals'],
            ['lead-guitar', 'Lead Guitar'],
            ['guitar-lead-a', 'Guitar Lead'],
            ['guitar-lead-b', 'Guitar Lead'],
        ]);

        const reply = await askAfterVocalsCommit('Lead Guitar Lead too');

        expect(reply).toContain(
            'Lead Guitar, the first Guitar Lead or the second Guitar Lead, counting from the top of the track list?'
        );
    });

    it('reads the fourth of four same-named tracks as that track', async () => {
        setProjectTracks(FOUR_LEADS);
        scriptProvider([[VOCALS_DOWN_3_DB]]);
        await commitVocalsDown3Db();

        await sendChatMessage('the fourth Lead too');
        await confirmIfProposed();

        expect(newestCommittedTrackIds()).toEqual(['lead-d']);
    });

    it('reads an order answer for a shared name holding regex metacharacters as that track', () => {
        setProjectTracks([
            ['take-a', 'Lead (take'],
            ['bass', 'Bass'],
            ['take-b', 'Lead (take'],
        ]);

        expect(readNamedTracks('the second Lead (take', getProjectContext())).toEqual({
            status: 'named',
            ids: ['take-b'],
        });
    });

    it('reads "the first First Lead" as the first of the tracks named First Lead, not a Lead', () => {
        setProjectTracks([
            ['first-a', 'First Lead'],
            ['first-b', 'First Lead'],
            ['lead-a', 'Lead'],
            ['lead-b', 'Lead'],
        ]);

        expect(readNamedTracks('the first First Lead', getProjectContext())).toEqual({
            status: 'named',
            ids: ['first-a'],
        });
    });

    const LONGER_NAME_TRACKS: ReadonlyArray<NamedTrack> = [...TWO_LEADS, ['slt', 'Second Lead Track']];

    it.each<readonly [prompt: string, tracks: ReadonlyArray<NamedTrack>, ids: readonly string[]]>([
        ['the second Lead track', LONGER_NAME_TRACKS, ['slt']],
        ['second Lead Vox', [...THREE_LEADS, ['slv', 'Second Lead Vox']], ['slv']],
    ])('reads "%s" as the longer track name it cuts into, never as an order reference', (prompt, tracks, ids): void => {
        setProjectTracks(tracks);

        expect(readNamedTracks(prompt, getProjectContext())).toEqual({ status: 'named', ids });
    });

    it('re-targets the track a longer name reads, not an order reference inside it', async () => {
        setProjectTracks(LONGER_NAME_TRACKS);
        scriptProvider([[VOCALS_DOWN_3_DB]]);
        await commitVocalsDown3Db();

        await sendChatMessage('the second Lead track too');
        await confirmIfProposed();

        expect(newestCommittedTrackIds()).toEqual(['slt']);
    });

    it('leaves a collision phrase with a tail of its own to ordinary planning, not the rename ask', async () => {
        setProjectTracks([
            ['track-vocals', 'Vocals'],
            ['lead-a', 'Lead'],
            ['lead-b', 'Lead'],
            ['second-lead', 'Second Lead'],
            ['track-bass', 'Bass'],
        ]);
        scriptProvider([
            [VOCALS_DOWN_3_DB],
            [{ name: 'muteTrack', arguments: { trackId: 'track-bass', muted: true } }],
        ]);
        await commitVocalsDown3Db();
        const calls = providerCallCount();

        await sendChatMessage('the second Lead louder too');

        expect(providerCallCount()).toBeGreaterThan(calls);
        expect(lastAssistantMessage()?.content ?? '').not.toContain('cannot be told apart');
    });

    it('takes "the first Lead" of a single Lead as that track', async () => {
        setProjectTracks([
            ['track-vocals', 'Vocals'],
            ['lead-a', 'Lead'],
        ]);
        scriptProvider([[VOCALS_DOWN_3_DB]]);
        await commitVocalsDown3Db();

        await sendChatMessage('the first Lead too');
        await confirmIfProposed();

        expect(newestCommittedTrackIds()).toEqual(['lead-a']);
    });

    it.each<readonly [prompt: string, tracks: ReadonlyArray<NamedTrack>, status: string]>([
        ['the third Lead', TWO_LEADS, 'ambiguous'],
        ['the second Bass', TWO_LEADS, 'unread'],
        ['the second', TWO_LEADS, 'unread'],
        ['track 2', TWO_LEADS, 'unread'],
        ['the second Lead Bass', TWO_LEADS, 'unread'],
        ['the 2nd Lead', TWO_LEADS, 'ambiguous'],
        ['Lead 2', TWO_LEADS, 'ambiguous'],
        ['the zeroth Lead', TWO_LEADS, 'ambiguous'],
        ['the second Lead', THREE_LEADS, 'named'],
        ['the fourth Lead', THREE_LEADS, 'ambiguous'],
        ['the second Lead', SECOND_LEAD_TRACKS, 'collision'],
        ['the second Lead louder', SECOND_LEAD_TRACKS, 'unread'],
        ['the third Lead louder', TWO_LEADS, 'ambiguous'],
        ['the fourth Lead', FOUR_LEADS, 'named'],
        [
            'the first First Lead',
            [
                ['first-a', 'First Lead'],
                ['first-b', 'First Lead'],
                ['lead-a', 'Lead'],
                ['lead-b', 'Lead'],
            ],
            'named',
        ],
        ['Second Lead', SECOND_TRACKS, 'collision'],
        [
            'First Lead',
            [
                ['lead-a', 'Lead'],
                ['first-lead', 'First Lead'],
            ],
            'named',
        ],
    ])('reads "%s" against its project', (prompt, tracks, status): void => {
        setProjectTracks(tracks);

        expect(readNamedTracks(prompt, getProjectContext()).status).toBe(status);
    });
});
