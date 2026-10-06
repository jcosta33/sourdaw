import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../../models/LlmActionLimits';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { WORKFLOW_CAPABILITY_IDS, WORKFLOW_CAPABILITY_TOOL_NAME } from '../../models/WorkflowCapability';
import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { resolveSemanticCommandListSelector } from '../../services/semanticCommandListCandidates';
import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { getBulkDeviceInsertionTrackScope } from '../agentReference/getBulkDeviceInsertionTrackScope';
import { getDrumRoutingPromptScope } from '../agentReference/getDrumRoutingPromptScope';
import { getWholeProjectVibeMixScope } from '../agentReference/getWholeProjectVibeMixScope';
import { rebaseBulkSetSliceEvidence } from '../agentRequestOrchestration/rebaseBulkSetSliceEvidence';
import { revalidateApprovedMatchSelectors } from '../agentRequestOrchestration/revalidateApprovedMatchSelectors';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type ArbitraryCommandListEvidence, compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { deriveMatchSelectorPredicates } from '../deriveMatchSelectorPredicates';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { planAgentRun } from '../planAgentRun';
import { sendChatMessage } from '../sendChatMessage';
import { splitCompiledCommandList } from '../splitCompiledCommandList';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    cycleProviderAttempt,
    discoverSearchedCalls,
    emptyMidiState,
    proposeDiscoveredCalls,
    scriptProviderTurns,
} from './highLevelIntentWorkflowFixture';

const runtimeMocks = vi.hoisted(() => ({ generateWebLlmCompletion: vi.fn() }));

/**
 * Muting a live track writes its channel strip, which builds a stereo panner. `src/setupTests.ts`
 * stubs an AudioContext with only the nodes the engine constructor needs, so the panner is added
 * here, as the other command-committing AI workflow suites do.
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
    function AudioContextWithPanner(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return Object.assign(context, {
            currentTime: 0,
            createStereoPanner: () => ({
                connect: (destination: unknown) => destination,
                disconnect: () => undefined,
                pan: createAudioParam(0),
            }),
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        writable: true,
        value: AudioContextWithPanner,
    });
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../../services/semanticCommandListCandidates', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../services/semanticCommandListCandidates')>();
    return { ...original, resolveSemanticCommandListSelector: vi.fn(original.resolveSemanticCommandListSelector) };
});

vi.mock('../getProjectContext', async (importOriginal) => {
    const original = await importOriginal<typeof import('../getProjectContext')>();
    return { ...original, getProjectContext: vi.fn(original.getProjectContext) };
});

const resolverSpy = vi.mocked(resolveSemanticCommandListSelector);

const resolverFoundNothing = { status: 'rejected', reason: 'forced for the test' } as const;

type CanonicalRole = NonNullable<ProjectContextTrack['canonicalRole']>;

const nameDerived = (role: string): CanonicalRole => ({ role, source: 'name-tags', evidence: 'name-tokens' });
const userSet = (role: string): CanonicalRole => ({ role, source: 'authored', evidence: 'authored-role' });

function createTrack(id: string, name: string, overrides: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
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
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
        sends: [],
        ...overrides,
    };
}

function createContext(tracks: ProjectContextTrack[], overrides: Partial<ProjectContext> = {}): ProjectContext {
    return {
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
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
        ...overrides,
    };
}

function resolvedSelectorsMatching(entity: 'track', match: unknown) {
    return resolverSpy.mock.calls.filter(
        ([input]) => input.selector.entity === entity && JSON.stringify(input.selector.match) === JSON.stringify(match)
    );
}

beforeEach(() => {
    resolverSpy.mockClear();
});

afterEach(() => {
    resolverSpy.mockReset();
});

describe('bulk device insertion scope', () => {
    const context = createContext([
        createTrack('track-bass-di', 'Bass DI'),
        createTrack('track-bass-frozen', 'Bass Frozen', { frozen: true }),
        createTrack('track-guitar', 'Guitar'),
    ]);

    it('takes its unfrozen targets and its frozen exclusions from the shared selector resolver', () => {
        const scope = getBulkDeviceInsertionTrackScope('Add EQ to every bass track', context);

        expect(scope).toEqual({
            targetIds: ['track-bass-di'],
            anchors: [],
            excludedFrozenTrackIds: ['track-bass-frozen'],
        });
        expect(
            resolvedSelectorsMatching('track', { all: [{ nameIncludes: 'bass' }, { isFrozen: false }] })
        ).toHaveLength(1);
        expect(
            resolvedSelectorsMatching('track', { all: [{ nameIncludes: 'bass' }, { isFrozen: true }] })
        ).toHaveLength(1);
    });

    it('claims no scope when the shared resolver names no track', () => {
        resolverSpy.mockReturnValue(resolverFoundNothing);

        expect(getBulkDeviceInsertionTrackScope('Add EQ to every bass track', context)).toBeNull();
    });

    it('keeps a name that only contains the family out of the scope', () => {
        const withBassoon = createContext([...context.tracks, createTrack('track-bassoon', 'Bassoon')]);

        expect(getBulkDeviceInsertionTrackScope('Add EQ to every bass track', withBassoon)?.targetIds).toEqual([
            'track-bass-di',
        ]);
    });
});

describe('drum routing scope', () => {
    const bus = createTrack('bus-drums', 'Drum Bus', { kind: 'bus', canonicalRole: nameDerived('bus') });
    const parallelReturn = createTrack('track-parallel', 'Parallel Compression Return', {
        kind: 'bus',
        canonicalRole: nameDerived('unknown'),
    });

    function createDrumContext(tracks: ProjectContextTrack[]): ProjectContext {
        return createContext([bus, parallelReturn, ...tracks]);
    }

    it('joins a track the user set to kick in the inspector and protects a Snare the user set to fx', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-thing', 'Thing 3', { canonicalRole: userSet('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: userSet('fx') }),
                createTrack('track-bass', 'Bass DI', { canonicalRole: nameDerived('bass') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick', 'track-thing']);
        expect(scope.capability?.candidateDrums).toContainEqual(
            expect.objectContaining({
                id: 'track-thing',
                role: 'kick',
                roleEvidence: 'canonical-role:kick:authored',
            })
        );
        expect(scope.capability?.protectedNonDrums).toContainEqual(
            expect.objectContaining({
                id: 'track-snare',
                role: 'fx',
                roleEvidence: 'canonical-role:fx:authored',
            })
        );
        expect(scope.capability?.allowedAction.forbiddenTargetIds).toContain('track-snare');
        expect(resolvedSelectorsMatching('track', { all: [{ roleFamily: 'drums' }] })).toHaveLength(1);
    });

    it('protects a Drums folder above the kit and still routes the kit', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('folder-drums', 'Drums', { kind: 'folder', canonicalRole: nameDerived('drums') }),
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: nameDerived('snare') }),
                createTrack('track-oh', 'OH', { canonicalRole: nameDerived('overhead') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick', 'track-snare', 'track-oh']);
        expect(scope.capability?.protectedNonDrums).toContainEqual(
            expect.objectContaining({ id: 'folder-drums', role: 'structural' })
        );
    });

    it('protects a bus carrying an authored kick role and still routes the kit', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('bus-aux', 'Aux 1', { kind: 'bus', canonicalRole: userSet('kick') }),
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: nameDerived('snare') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick', 'track-snare']);
        expect(scope.capability?.protectedNonDrums).toContainEqual(
            expect.objectContaining({ id: 'bus-aux', role: 'structural' })
        );
    });

    it('labels a drum-named track by the drum role the user authored for it', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([createTrack('track-kick', 'Kick', { canonicalRole: userSet('snare') })]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.capability?.candidateDrums).toContainEqual(
            expect.objectContaining({
                id: 'track-kick',
                role: 'snare',
                roleEvidence: 'canonical-role:snare:authored',
            })
        );
    });

    it('routes an overhead and a drum room by their canonical roles, with no name fallback', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-oh', 'OH', { canonicalRole: nameDerived('overhead') }),
                createTrack('track-room', 'Drum Room', { canonicalRole: nameDerived('room') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-oh', 'track-room']);
        expect(scope.capability?.candidateDrums).toEqual([
            expect.objectContaining({
                id: 'track-oh',
                role: 'overhead',
                roleEvidence: 'canonical-role:overhead:name-tags',
            }),
            expect.objectContaining({
                id: 'track-room',
                role: 'room',
                roleEvidence: 'canonical-role:room:name-tags',
            }),
        ]);
    });

    it('protects utility and orchestral tracks and routes the kit around them', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-click', 'Click', { canonicalRole: nameDerived('utility') }),
                createTrack('track-hat-trick', 'Hat Trick', { canonicalRole: nameDerived('utility') }),
                createTrack('track-strings', 'Strings', { canonicalRole: nameDerived('strings') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick']);
        expect(scope.capability?.protectedNonDrums).toEqual([
            expect.objectContaining({ id: 'track-click', role: 'utility' }),
            expect.objectContaining({ id: 'track-hat-trick', role: 'utility' }),
            expect.objectContaining({ id: 'track-strings', role: 'strings' }),
        ]);
    });

    it('refuses the scope for a track whose canonical role is unknown, whatever its name says', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-oh', 'OH', { canonicalRole: nameDerived('unknown') }),
            ])
        );

        expect(scope).toEqual({ status: 'invalid', reason: 'MF-01 track role is ambiguous: track-oh' });
    });

    it('still refuses the whole scope for a frozen drum instead of dropping it', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: nameDerived('snare'), frozen: true }),
            ])
        );

        expect(scope).toEqual({
            status: 'invalid',
            reason: 'MF-01 drum target is protected or locked: track-snare',
        });
    });

    it('finds its drums only through the shared resolver once every track carries a canonical role', () => {
        resolverSpy.mockReturnValue(resolverFoundNothing);

        expect(
            getDrumRoutingPromptScope(
                createDrumContext([createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') })])
            )
        ).toEqual({ status: 'invalid', reason: 'MF-01 found no unambiguous drum tracks' });
    });
});

describe('whole-project vibe-mix scope', () => {
    const context = createContext(
        [
            createTrack('bus-drums', 'Drum Bus', { kind: 'bus' }),
            createTrack('bus-bass', 'Bass Bus', { kind: 'bus' }),
            createTrack('track-vocal', 'Lead Vocal'),
            createTrack('master', 'Master', { kind: 'master' }),
        ],
        {
            sections: [
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 0, endBeat: 8 },
                { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 8, endBeat: 16 },
            ],
        }
    );

    it('discovers the drum and bass impact buses through the shared selector resolver', () => {
        expect(getWholeProjectVibeMixScope(context)?.targetIds).toEqual(['bus-drums', 'bus-bass']);
        expect(
            resolvedSelectorsMatching('track', {
                all: [{ kind: 'bus' }, { nameIncludes: 'drum' }, { nameIncludes: 'bus' }],
            })
        ).toHaveLength(1);
        expect(
            resolvedSelectorsMatching('track', {
                all: [{ kind: 'bus' }, { nameIncludes: 'bass' }, { nameIncludes: 'bus' }],
            })
        ).toHaveLength(1);
    });

    it('claims no scope when the shared resolver names no bus', () => {
        resolverSpy.mockReturnValue(resolverFoundNothing);

        expect(getWholeProjectVibeMixScope(context)).toBeNull();
    });

    it('refuses two buses that both name the role', () => {
        const withSecondDrumBus = createContext(
            [...context.tracks, createTrack('bus-drums-two', 'Drum Bus 2', { kind: 'bus' })],
            {
                sections: context.sections,
            }
        );

        expect(getWholeProjectVibeMixScope(withSecondDrumBus)).toBeNull();
    });
});

const BULK_REVISION = 'revision-bulk';

const gainParameter = {
    id: 'gain',
    name: 'Gain',
    type: 'float' as const,
    value: 0,
    minValue: -24,
    maxValue: 24,
    unit: 'dB',
};

function bulkTrackId(prefix: string, index: number): string {
    return `track-${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function createBulkTracks(prefix: string, name: string, count: number): ProjectContextTrack[] {
    return Array.from({ length: count }, (_unused, index) => {
        const id = bulkTrackId(prefix, index);
        return createTrack(id, `${name} ${String(index + 1)}`, {
            devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false, parameters: [gainParameter] }],
        });
    });
}

/** The device catalogue the bridge resolves a device type argument against, by id or name. */
const BULK_DEVICE_CATALOGUE = [
    { id: 'builtin-eq', name: 'EQ' },
    { id: 'builtin-compressor', name: 'Compressor' },
    { id: 'builtin-reverb', name: 'Reverb' },
];

function createBulkContext(tracks: ProjectContextTrack[]): ProjectContext {
    return createContext([...tracks, createTrack('bus-fx', 'FX Bus', { kind: 'bus', devices: [] })], {
        availableDeviceTypes: BULK_DEVICE_CATALOGUE,
    });
}

function bulkPlan() {
    return {
        semantic: { classification: 'complex', uncertainty: [] },
        objective: 'Apply one change across a set of tracks.',
        constraints: [],
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        capabilityIds: [],
        assetIds: [],
        alternatives: [],
        validationStrategy: [],
        stoppingConditions: [],
    };
}

function matchTracks(nameIncludes: string, exactly: number, targetArgument = 'trackId') {
    return {
        targetArgument,
        entity: 'track',
        match: { all: [{ nameIncludes }] },
        quantity: { unit: 'targets', exactly },
    };
}

function compileBulk(context: ProjectContext, items: Array<Record<string, unknown>>) {
    const compiled = compileArbitraryCommandList({
        context,
        revision: BULK_REVISION,
        calls: [{ name: 'command.batch.propose', arguments: { plan: bulkPlan(), list: { schemaVersion: 1, items } } }],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(`Expected the bulk list to compile: ${JSON.stringify(compiled)}`);
    }
    return compiled;
}

function splitBulk(context: ProjectContext, items: Array<Record<string, unknown>>) {
    const compiled = compileBulk(context, items);
    return {
        evidence: compiled.compilerEvidence!,
        split: splitCompiledCommandList({
            evidence: compiled.compilerEvidence!,
            maxCommandsPerBatch: MAX_LLM_ACTIONS_PER_BATCH,
            setSelectors: compiled.setSelectors,
        }),
    };
}

function requireSlices(result: ReturnType<typeof splitCompiledCommandList>): ArbitraryCommandListEvidence[] {
    if (result.status !== 'accepted') {
        throw new Error(`Expected the list to split: ${result.reason}`);
    }
    return result.slices;
}

function validateSlice(slice: ArbitraryCommandListEvidence, context: ProjectContext, revision = BULK_REVISION) {
    return validateArbitraryCommandListEvidence({
        evidence: slice,
        calls: slice.commands,
        context,
        revision,
        creativeAuthority: undefined,
    });
}

const LATER_REVISION = 'revision-after-batch-one';

/** The first twelve takes are leads, so a selector can name a twelve-clip subset of every take. */
function takeName(index: number): string {
    if (index < 12) {
        return `Take Lead ${String(index + 1)}`;
    }
    return `Take ${String(index + 1)}`;
}

function updateTracks(
    base: ProjectContext,
    update: (track: ProjectContextTrack) => ProjectContextTrack
): ProjectContext {
    return { ...base, tracks: base.tracks.map(update) };
}

/** `update` applied to the tracks `ids` names, every other track as it was. */
function updateTracksIn(
    base: ProjectContext,
    ids: ReadonlySet<string>,
    update: (track: ProjectContextTrack) => ProjectContextTrack
): ProjectContext {
    return updateTracks(base, (track) => {
        if (!ids.has(track.id)) {
            return track;
        }
        return update(track);
    });
}

function briefWithRole(trackId: string, role: string): NonNullable<ProjectContext['productionBrief']> {
    return {
        schemaVersion: 1,
        id: 'brief-1',
        revision: 1,
        vision: null,
        references: [],
        hardConstraints: [],
        preferences: [],
        sectionGoals: [],
        trackRoles: [{ id: 'role-1', trackId, role, createdAt: 1 }],
        locks: [],
        decisions: [],
        unresolvedQuestions: [],
        sourceRunLinks: [],
        supersedesBriefId: null,
        supersededByBriefId: null,
        createdAt: 1,
        updatedAt: 1,
    };
}

/** Every candidate fingerprint the schedule's slices recorded at compile time. */
function recordedFingerprints(slices: readonly ArbitraryCommandListEvidence[]): Map<string, string> {
    return new Map(
        slices.flatMap((slice) =>
            slice.selectors.flatMap((selector) =>
                selector.preconditions.map((precondition): [string, string] => [
                    precondition.stableId,
                    precondition.fingerprint,
                ])
            )
        )
    );
}

/** Rebases slice `position` the way the run proposes it once every earlier slice committed, then validates it. */
function replayLaterSlice(slices: readonly ArbitraryCommandListEvidence[], position: number, live: ProjectContext) {
    const rebased = rebaseBulkSetSliceEvidence({
        evidence: slices[position - 1]!,
        context: live,
        revision: LATER_REVISION,
        earlierCommands: slices.slice(0, position - 1).flatMap((slice) => slice.commands),
        recordedFingerprints: recordedFingerprints(slices),
    });
    if (rebased.status === 'rejected') {
        return rebased;
    }
    return validateSlice(rebased.evidence, live, LATER_REVISION);
}

describe('bulk set commands across successive batches', () => {
    const layers = createBulkTracks('layer', 'Layer', 30);
    const context = createBulkContext(layers);
    const familyItems = {
        'device insertion': {
            id: 'insert-eq',
            name: 'addDevice',
            arguments: { deviceType: 'builtin-eq' },
            selector: matchTracks('layer', 30),
        },
        send: {
            id: 'send-to-fx',
            name: 'addSend',
            arguments: { busId: 'bus-fx', levelDb: -6 },
            selector: matchTracks('layer', 30),
        },
        output: {
            id: 'route-to-fx',
            name: 'setTrackOutput',
            arguments: { outputId: 'bus-fx' },
            selector: matchTracks('layer', 30),
        },
        parameter: {
            id: 'set-eq-gain',
            name: 'setDeviceParameter',
            arguments: { paramId: 'gain', value: 3 },
            selector: {
                targetArgument: 'deviceId',
                entity: 'device',
                where: { type: 'builtin-eq' },
                quantity: { unit: 'targets', exactly: 30 },
            },
        },
        automation: {
            id: 'automate-gain',
            name: 'addAutomationLane',
            arguments: { parameterId: 'gain' },
            selector: matchTracks('layer', 30),
        },
    } as const;

    it.each(Object.entries(familyItems))(
        'splits a 30-target %s into a batch of 24 and a batch of 6 that each validate',
        (_family, item) => {
            const slices = requireSlices(splitBulk(context, [item]).split);

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 6]);
            for (const slice of slices) {
                expect(validateSlice(slice, context)).toMatchObject({ status: 'accepted' });
            }
        }
    );

    const muteLayers = {
        id: 'mute-layers',
        name: 'muteTrack',
        arguments: { muted: true },
        selector: matchTracks('layer', 30),
    };

    it('records where each batch of a 30-target mute sits in its set', () => {
        const slices = requireSlices(splitBulk(context, [muteLayers]).split);
        const layerIds = layers.map((track) => track.id);

        expect(slices.map((slice) => slice.selectors[0]?.slice?.offset)).toEqual([0, 24]);
        expect(slices.map((slice) => slice.selectors[0]?.stableIds)).toEqual([
            layerIds.slice(0, 24),
            layerIds.slice(24),
        ]);
        expect(slices.map((slice) => slice.selectors[0]?.slice?.setStableIds)).toEqual([layerIds, layerIds]);
        expect(slices.map((slice) => slice.providerKnownTargetIds)).toEqual([
            layerIds.slice(0, 24),
            layerIds.slice(24),
        ]);
    });

    it('leaves a list of 24 or fewer exactly as compiled', () => {
        const smaller = createBulkContext(createBulkTracks('layer', 'Layer', 24));
        const { evidence, split } = splitBulk(smaller, [{ ...muteLayers, selector: matchTracks('layer', 24) }]);

        expect(requireSlices(split)[0]).toBe(evidence);
        expect(requireSlices(split)).toHaveLength(1);
        expect(evidence.selectors[0]).not.toHaveProperty('slice');
    });

    const alphaBeta = createBulkContext([
        ...createBulkTracks('alpha', 'Alpha', 10),
        ...createBulkTracks('beta', 'Beta', 20),
    ]);
    const parallelBus = { id: 'make-bus', name: 'createBus', arguments: { name: 'Parallel', binding: 'par' } };
    const sendToParallel = (nameIncludes: string, exactly: number) => ({
        id: 'send-to-parallel',
        name: 'addSend',
        arguments: { busId: '$par', levelDb: -6 },
        selector: matchTracks(nameIncludes, exactly),
        dependsOn: ['make-bus'],
    });

    it('keeps a binding producer and every command naming it in one batch', () => {
        const slices = requireSlices(
            splitBulk(alphaBeta, [
                { ...muteLayers, id: 'mute-alpha', selector: matchTracks('alpha', 10) },
                parallelBus,
                sendToParallel('beta', 20),
            ]).split
        );

        expect(slices.map((slice) => slice.commands.length)).toEqual([10, 21]);
        expect(slices.map((slice) => validateSlice(slice, alphaBeta).status)).toEqual(['accepted', 'accepted']);
    });

    it('refuses a binding whose producer and consumers exceed one batch', () => {
        expect(splitBulk(context, [parallelBus, sendToParallel('layer', 30)]).split).toEqual({
            status: 'rejected',
            reason: 'Batch-local binding $par and the commands that use it exceed one batch of 24 commands.',
        });
    });

    it('keeps a command that writes a whole set in one batch', () => {
        const slices = requireSlices(
            splitBulk(context, [
                muteLayers,
                {
                    id: 'group-layers',
                    name: 'createVcaGroup',
                    arguments: { name: 'Layers' },
                    selector: matchTracks('layer', 30, 'trackIds'),
                },
            ]).split
        );

        expect(slices.map((slice) => slice.commands.length)).toEqual([24, 7]);
        expect(slices[1]?.commands.at(-1)?.arguments.trackIds).toEqual(layers.map((track) => track.id));
        expect(slices.map((slice) => validateSlice(slice, context).status)).toEqual(['accepted', 'accepted']);
    });

    it.each([
        { refused: 'creative authority', evidence: { creativeAuthorityId: 'creative-authority-1' } },
        { refused: 'MIDI transforms', evidence: { expandedMidiTransforms: ['chordProgression'] } },
    ])('refuses to split a list carrying $refused', ({ evidence }) => {
        const compiled = compileBulk(context, [muteLayers]);

        expect(
            splitCompiledCommandList({
                evidence: { ...compiled.compilerEvidence!, ...evidence },
                maxCommandsPerBatch: MAX_LLM_ACTIONS_PER_BATCH,
                setSelectors: compiled.setSelectors,
            })
        ).toMatchObject({ status: 'rejected' });
    });

    it('refuses to split a list whose items share one command', () => {
        expect(
            splitBulk(context, [
                muteLayers,
                {
                    id: 'mute-first-layer',
                    name: 'muteTrack',
                    arguments: { muted: true },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { name: 'Layer 1' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ]).split
        ).toEqual({
            status: 'rejected',
            reason: 'Commands shared between list items cannot run as successive batches.',
        });
    });

    it('rejects a selector over 129 targets and splits 128 into six batches', () => {
        const wide = createBulkContext(createBulkTracks('layer', 'Layer', 129));
        const narrower = createBulkContext(createBulkTracks('layer', 'Layer', 128));

        expect(
            compileArbitraryCommandList({
                context: wide,
                revision: BULK_REVISION,
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: bulkPlan(),
                            list: { schemaVersion: 1, items: [{ ...muteLayers, selector: matchTracks('layer', 129) }] },
                        },
                    },
                ],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        });
        const slices = requireSlices(
            splitBulk(narrower, [{ ...muteLayers, selector: matchTracks('layer', 128) }]).split
        );
        expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 24, 24, 24, 8]);
    });

    it('rejects an expansion past the run command ceiling', () => {
        const wide = createBulkContext(createBulkTracks('layer', 'Layer', 128));
        const items = [
            { id: 'mute', name: 'muteTrack', arguments: { muted: true } },
            { id: 'solo', name: 'soloTrack', arguments: { soloed: true } },
            { id: 'insert', name: 'addDevice', arguments: { deviceType: 'builtin-eq' } },
            { id: 'automate', name: 'addAutomationLane', arguments: { parameterId: 'gain' } },
            { id: 'send', name: 'addSend', arguments: { busId: 'bus-fx', levelDb: -6 } },
        ].map((item) => ({ ...item, selector: matchTracks('layer', 128) }));

        expect(
            compileArbitraryCommandList({
                context: wide,
                revision: BULK_REVISION,
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: { plan: bulkPlan(), list: { schemaVersion: 1, items } },
                    },
                ],
            })
        ).toEqual({ status: 'rejected', reason: 'Structured command list exceeds the application command budget.' });
    });

    describe('a later batch replayed against the live project', () => {
        const slices = requireSlices(splitBulk(context, [muteLayers]).split);
        const secondSlice = slices[1]!;
        const firstSliceIds = layers.slice(0, 24).map((track) => track.id);
        const withTracks = (tracks: ProjectContextTrack[]) => ({ ...context, tracks });
        const replay = (live: ProjectContext) => replayLaterSlice(slices, 2, live);
        // Batch one muted its targets, and the user renamed a track no batch touches.
        const afterBatchOne = withTracks(
            context.tracks.map((track) => {
                if (firstSliceIds.includes(track.id)) {
                    return { ...track, muted: true };
                }
                return track.id === 'bus-fx' ? { ...track, name: 'Renamed FX Bus' } : track;
            })
        );

        it('accepts the batch after the run changed earlier members and the user edited an unrelated track', () => {
            expect(replay(afterBatchOne)).toMatchObject({ status: 'accepted' });
        });

        it('refuses the batch when one of its own targets changed', () => {
            const changed = withTracks(
                afterBatchOne.tracks.map((track) => (track.id === layers[26]!.id ? { ...track, muted: true } : track))
            );

            expect(replay(changed)).toEqual({
                status: 'rejected',
                reason: 'Structured command compiler evidence preconditions no longer hold.',
            });
        });

        it('refuses the batch when one of its targets vanished', () => {
            const vanished = withTracks(afterBatchOne.tracks.filter((track) => track.id !== layers[27]!.id));

            expect(replay(vanished)).toEqual({
                status: 'rejected',
                reason: `Target ${layers[27]!.id} is no longer in the project.`,
            });
        });

        it('refuses the batch when its set gained a member', () => {
            const gained = withTracks([...afterBatchOne.tracks, createTrack('track-layer-new', 'Layer 31')]);

            expect(replay(gained)).toEqual({
                status: 'rejected',
                reason: 'Bulk selector mute-layers no longer resolves the set its earlier batches started from.',
            });
        });

        it('accepts a later batch whose targets an earlier batch of the same run already changed', () => {
            const soloLayers = { id: 'solo-layers', name: 'soloTrack', arguments: { soloed: true } };
            const muteThenSolo = requireSlices(
                splitBulk(context, [muteLayers, { ...soloLayers, selector: matchTracks('layer', 30) }]).split
            );
            const middle = muteThenSolo[1]!;

            expect(muteThenSolo.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
            expect(middle.selectors.map((selector) => selector.itemId)).toEqual(['mute-layers', 'solo-layers']);
            expect(replayLaterSlice(muteThenSolo, 2, afterBatchOne)).toMatchObject({ status: 'accepted' });
        });

        it('revalidates a pending later batch against the set beyond its earlier members', () => {
            const records = deriveMatchSelectorPredicates(secondSlice);
            const contextSpy = vi.mocked(getProjectContext);

            expect(records[0]?.slice).toEqual({ setStableIds: layers.map((track) => track.id), offset: 24 });
            contextSpy.mockReturnValueOnce(afterBatchOne);
            expect(revalidateApprovedMatchSelectors(records)).toEqual({ status: 'unchanged' });
            contextSpy.mockReturnValueOnce(
                withTracks([...afterBatchOne.tracks, createTrack('track-layer-new', 'Layer 31')])
            );
            expect(revalidateApprovedMatchSelectors(records)).toMatchObject({ status: 'invalidated' });
        });
    });

    describe("facts the run's own earlier batches wrote", () => {
        const takeContext = createBulkContext(
            layers.map((track, index) => ({
                ...track,
                clipCount: 1,
                clips: [
                    {
                        id: `clip-take-${String(index + 1).padStart(3, '0')}`,
                        name: takeName(index),
                        type: 'audio' as const,
                        startBeat: 0,
                        endBeat: 4,
                        noteCount: 0,
                        muted: false,
                        locked: false,
                    },
                ],
            }))
        );
        // What the project holds once the run's batches muted the first `count` layer tracks.
        const mutedThrough = (base: ProjectContext, count: number): ProjectContext => {
            const mutedIds = new Set(layers.slice(0, count).map((track) => track.id));
            return {
                ...base,
                tracks: base.tracks.map((track) => (mutedIds.has(track.id) ? { ...track, muted: true } : track)),
            };
        };
        const setTakeGain = {
            id: 'set-take-gain',
            name: 'setClipGain',
            arguments: { gain: 0.5 },
            selector: {
                targetArgument: 'clipId',
                entity: 'clip',
                match: { all: [{ nameIncludes: 'take' }] },
                quantity: { unit: 'targets', exactly: 30 },
            },
        };
        const soloUnmuted = {
            id: 'solo-unmuted',
            name: 'soloTrack',
            arguments: { soloed: true },
            selector: {
                targetArgument: 'trackId',
                entity: 'track',
                match: { all: [{ nameIncludes: 'layer' }, { isMuted: false }] },
                quantity: { unit: 'targets', exactly: 30 },
            },
        };

        it('accepts later batches whose candidates the run muted through their owner track', () => {
            const slices = requireSlices(splitBulk(takeContext, [muteLayers, setTakeGain]).split);

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
            expect(replayLaterSlice(slices, 2, mutedThrough(takeContext, 24))).toMatchObject({ status: 'accepted' });
            expect(replayLaterSlice(slices, 3, mutedThrough(takeContext, 30))).toMatchObject({ status: 'accepted' });
        });

        it('still refuses a later batch whose candidate someone else muted', () => {
            const slices = requireSlices(splitBulk(takeContext, [muteLayers, setTakeGain]).split);
            const afterRun = mutedThrough(takeContext, 24);
            const muteTakes = (track: ProjectContextTrack): ProjectContextTrack => {
                if (track.id !== layers[4]!.id) {
                    return track;
                }
                return { ...track, clips: track.clips.map((clip) => ({ ...clip, muted: true })) };
            };
            const userMutedTake = { ...afterRun, tracks: afterRun.tracks.map(muteTakes) };

            expect(replayLaterSlice(slices, 2, userMutedTake)).toEqual({
                status: 'rejected',
                reason: 'Structured command compiler evidence preconditions no longer hold.',
            });
        });

        it('accepts later batches whose set the run changed by muting its members', () => {
            const slices = requireSlices(splitBulk(context, [muteLayers, soloUnmuted]).split);

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
            expect(replayLaterSlice(slices, 2, mutedThrough(context, 24))).toMatchObject({ status: 'accepted' });
            expect(replayLaterSlice(slices, 3, mutedThrough(context, 30))).toMatchObject({ status: 'accepted' });
        });

        const firstLayers = (count: number) => new Set(layers.slice(0, count).map((track) => track.id));
        const onLayer = (index: number) => new Set([layers[index]!.id]);
        const addDeviceTo = (base: ProjectContext, ids: ReadonlySet<string>, type: string, suffix: string) =>
            updateTracksIn(base, ids, (track) => ({
                ...track,
                devices: [...track.devices, { id: `${track.id}-${suffix}`, name: type, type, bypassed: false }],
            }));
        const patchClips = (
            base: ProjectContext,
            ids: ReadonlySet<string>,
            patch: { muted?: boolean; locked?: boolean }
        ) =>
            updateTracksIn(base, ids, (track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, ...patch })),
            }));
        const setEqBypassed = (base: ProjectContext, ids: ReadonlySet<string>, bypassed: boolean) =>
            updateTracksIn(base, ids, (track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, bypassed })),
            }));
        const addCompressor = {
            id: 'add-compressor',
            name: 'addDevice',
            arguments: { deviceType: 'builtin-compressor' },
            selector: matchTracks('layer', 30),
        };
        const clipSelector = (match: Record<string, unknown>, exactly: number, condition?: Record<string, unknown>) => {
            const selector: Record<string, unknown> = {
                targetArgument: 'clipId',
                entity: 'clip',
                match,
                quantity: { unit: 'targets', exactly },
            };
            if (condition !== undefined) {
                selector.condition = condition;
            }
            return selector;
        };
        const eqSelector = (condition?: Record<string, unknown>) => {
            const selector: Record<string, unknown> = {
                targetArgument: 'deviceId',
                entity: 'device',
                where: { type: 'builtin-eq' },
                quantity: { unit: 'targets', exactly: 30 },
            };
            if (condition !== undefined) {
                selector.condition = condition;
            }
            return selector;
        };
        const takes = { all: [{ nameIncludes: 'take' }] };

        describe("the run's own addDevice on an owner track", () => {
            const soloEqLayers = {
                id: 'solo-eq-layers',
                name: 'soloTrack',
                arguments: { soloed: true },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    match: { all: [{ nameIncludes: 'layer' }, { hasDeviceType: 'builtin-eq' }] },
                    quantity: { unit: 'targets', exactly: 30 },
                },
            };
            const slices = requireSlices(splitBulk(context, [addCompressor, soloEqLayers]).split);
            const afterRun = addDeviceTo(context, firstLayers(24), 'builtin-compressor', 'added');

            it('accepts the later batch', () => {
                expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
                expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            });

            it('refuses an outside device on a track the run added one to', () => {
                const outside = addDeviceTo(afterRun, onLayer(4), 'builtin-reverb', 'outside');

                expect(replayLaterSlice(slices, 2, outside)).toEqual({
                    status: 'rejected',
                    reason: 'Structured command compiler evidence preconditions no longer hold.',
                });
            });

            it('refuses a second device of the added type the run did not add', () => {
                const outside = addDeviceTo(afterRun, onLayer(4), 'builtin-compressor', 'outside');

                expect(replayLaterSlice(slices, 2, outside)).toEqual({
                    status: 'rejected',
                    reason: 'Structured command compiler evidence preconditions no longer hold.',
                });
            });

            it('refuses an outside role on a track the run added one to', () => {
                const outside = { ...afterRun, productionBrief: briefWithRole(layers[4]!.id, 'vocal') };

                expect(replayLaterSlice(slices, 2, outside)).toEqual({
                    status: 'rejected',
                    reason: 'Structured command compiler evidence preconditions no longer hold.',
                });
            });
        });

        describe("a set read through the device facts the run's addDevice changed", () => {
            const compBuses = createBulkTracks('bus', 'Comp Bus', 30).map((track) => ({
                ...track,
                devices: [
                    ...track.devices,
                    { id: `${track.id}-comp`, name: 'Comp', type: 'builtin-compressor', bypassed: false },
                ],
            }));
            const withBuses = createBulkContext([...layers, ...compBuses]);
            const afterRun = addDeviceTo(withBuses, firstLayers(24), 'builtin-compressor', 'added');
            const soloBusesBy = (predicate: Record<string, unknown>) => ({
                id: 'solo-comp-buses',
                name: 'soloTrack',
                arguments: { soloed: true },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    match: { all: [predicate] },
                    quantity: { unit: 'targets', exactly: 30 },
                },
            });

            it.each([
                { fact: 'device types', predicate: { hasDeviceType: 'builtin-compressor' } },
                { fact: 'tags', predicate: { tag: 'builtin-compressor' } },
            ])('accepts a later batch whose set the run grew through its owner $fact', ({ predicate }) => {
                const slices = requireSlices(splitBulk(withBuses, [addCompressor, soloBusesBy(predicate)]).split);

                expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            });

            // The bridge resolves a device type by catalogue id or name, case-insensitively, and the
            // project stores the resolved id, so the run's addition is the resolved type.
            it.each([
                { argument: 'Compressor', fact: 'device types', predicate: { hasDeviceType: 'builtin-compressor' } },
                { argument: 'Compressor', fact: 'tags', predicate: { tag: 'builtin-compressor' } },
                {
                    argument: 'BUILTIN-COMPRESSOR',
                    fact: 'device types',
                    predicate: { hasDeviceType: 'builtin-compressor' },
                },
                { argument: 'BUILTIN-COMPRESSOR', fact: 'tags', predicate: { tag: 'builtin-compressor' } },
            ])('accepts the run addition named $argument through its owner $fact', ({ argument, predicate }) => {
                const addNamedCompressor = { ...addCompressor, arguments: { deviceType: argument } };
                const slices = requireSlices(splitBulk(withBuses, [addNamedCompressor, soloBusesBy(predicate)]).split);

                expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            });
        });

        describe('owner facts the run wrote on candidates no selector targeted', () => {
            const takeClip = (trackId: string, name: string) => ({
                id: `${trackId}-clip`,
                name,
                type: 'audio' as const,
                startBeat: 0,
                endBeat: 4,
                noteCount: 0,
                muted: false,
                locked: false,
            });
            const busesWithClips = (muted: boolean) =>
                createBulkTracks('bus', 'Comp Bus', 30).map((track) => ({
                    ...track,
                    muted,
                    clipCount: 1,
                    clips: [takeClip(track.id, 'Bus Take')],
                    devices: [
                        ...track.devices,
                        { id: `${track.id}-comp`, name: 'Comp', type: 'builtin-compressor', bypassed: false },
                    ],
                }));
            const layersWithTakes = layers.map((track) => ({
                ...track,
                clipCount: 1,
                clips: [takeClip(track.id, 'Layer Take')],
            }));
            const gainCompClips = (predicate: Record<string, unknown>) => ({
                id: 'gain-comp-clips',
                name: 'setClipGain',
                arguments: { gain: 0.5 },
                selector: {
                    targetArgument: 'clipId',
                    entity: 'clip',
                    match: { all: [predicate] },
                    quantity: { unit: 'targets', exactly: 30 },
                },
            });
            const deviceContext = createBulkContext([...layersWithTakes, ...busesWithClips(false)]);
            const deviceSlices = requireSlices(
                splitBulk(deviceContext, [addCompressor, gainCompClips({ hasDeviceType: 'builtin-compressor' })]).split
            );
            const afterAddDevice = addDeviceTo(deviceContext, firstLayers(24), 'builtin-compressor', 'added');

            it("accepts a later batch whose untargeted clips gained the run's own device through their track", () => {
                expect(deviceSlices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
                expect(replayLaterSlice(deviceSlices, 2, afterAddDevice)).toMatchObject({ status: 'accepted' });
            });

            it("refuses an outside device on a track the run already touched, through that track's untargeted clip", () => {
                const outside = addDeviceTo(afterAddDevice, onLayer(4), 'builtin-reverb', 'outside');

                expect(replayLaterSlice(deviceSlices, 2, outside)).toEqual({
                    status: 'rejected',
                    reason: 'Bulk selector gain-comp-clips no longer resolves the set its earlier batches started from.',
                });
            });

            it('accepts a later batch whose untargeted clips the run muted through their track', () => {
                const mutedBusContext = createBulkContext([...layersWithTakes, ...busesWithClips(true)]);
                const slices = requireSlices(
                    splitBulk(mutedBusContext, [muteLayers, gainCompClips({ isMuted: true })]).split
                );

                expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
                expect(replayLaterSlice(slices, 2, mutedThrough(mutedBusContext, 24))).toMatchObject({
                    status: 'accepted',
                });
            });
        });

        it('revalidates at approval a whole later item whose set the run changed', () => {
            const soloLayerOnes = {
                id: 'solo-layer-ones',
                name: 'soloTrack',
                arguments: { soloed: true },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    match: { all: [{ nameIncludes: 'layer 1' }, { isMuted: false }] },
                    quantity: { unit: 'targets', exactly: 11 },
                },
            };
            const slices = requireSlices(splitBulk(context, [muteLayers, soloLayerOnes]).split);
            const afterRun = mutedThrough(context, 24);
            const rebased = rebaseBulkSetSliceEvidence({
                evidence: slices[1]!,
                context: afterRun,
                revision: LATER_REVISION,
                earlierCommands: slices[0]!.commands,
                recordedFingerprints: recordedFingerprints(slices),
            });
            if (rebased.status === 'rejected') {
                throw new Error(rebased.reason);
            }
            const records = deriveMatchSelectorPredicates(rebased.evidence);
            const wholeRecord = records.find((record) => record.itemId === 'solo-layer-ones');

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 17]);
            expect(wholeRecord).toBeDefined();
            expect(wholeRecord?.slice).toBeUndefined();
            vi.mocked(getProjectContext).mockReturnValueOnce(afterRun);
            expect(revalidateApprovedMatchSelectors(wholeRecord === undefined ? [] : [wholeRecord])).toEqual({
                status: 'unchanged',
            });
        });

        it('accepts a later batch whose muted condition the run changed, and refuses an outside mute', () => {
            const soloUnmutedByCondition = {
                id: 'solo-unmuted-condition',
                name: 'soloTrack',
                arguments: { soloed: true },
                selector: { ...matchTracks('layer', 30), condition: { field: 'muted', equals: false } },
            };
            const slices = requireSlices(splitBulk(context, [muteLayers, soloUnmutedByCondition]).split);
            const afterRun = mutedThrough(context, 24);

            expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            expect(
                replayLaterSlice(
                    slices,
                    2,
                    updateTracksIn(afterRun, onLayer(26), (track) => ({ ...track, muted: true }))
                )
            ).toMatchObject({ status: 'rejected' });
        });

        it("accepts the run's own muteClip and refuses an outside clip mute", () => {
            const slices = requireSlices(
                splitBulk(takeContext, [
                    {
                        id: 'mute-takes',
                        name: 'muteClip',
                        arguments: { muted: true },
                        selector: clipSelector(takes, 30),
                    },
                    {
                        id: 'gain-unmuted-takes',
                        name: 'setClipGain',
                        arguments: { gain: 0.5 },
                        selector: clipSelector(takes, 30, { field: 'muted', equals: false }),
                    },
                ]).split
            );
            const afterRun = patchClips(takeContext, firstLayers(24), { muted: true });

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
            expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            expect(replayLaterSlice(slices, 2, patchClips(afterRun, onLayer(26), { muted: true }))).toMatchObject({
                status: 'rejected',
            });
        });

        it("accepts the run's own lockClip and refuses an outside clip lock", () => {
            const slices = requireSlices(
                splitBulk(takeContext, [
                    {
                        id: 'lock-takes',
                        name: 'lockClip',
                        arguments: { locked: true },
                        selector: clipSelector(takes, 30),
                    },
                    {
                        id: 'duplicate-unlocked-leads',
                        name: 'duplicateClip',
                        arguments: {},
                        selector: clipSelector({ all: [{ nameIncludes: 'take lead' }] }, 12, {
                            field: 'locked',
                            equals: false,
                        }),
                    },
                ]).split
            );
            const afterRun = patchClips(takeContext, firstLayers(24), { locked: true });

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 18]);
            expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            expect(replayLaterSlice(slices, 2, patchClips(afterRun, onLayer(26), { locked: true }))).toMatchObject({
                status: 'rejected',
            });
        });

        it("accepts the run's own bypassDevice and refuses an outside bypass", () => {
            const slices = requireSlices(
                splitBulk(context, [
                    { id: 'bypass-eqs', name: 'bypassDevice', arguments: { bypassed: true }, selector: eqSelector() },
                    {
                        id: 'gain-active-eqs',
                        name: 'setDeviceParameter',
                        arguments: { paramId: 'gain', value: 3 },
                        selector: eqSelector({ field: 'bypassed', equals: false }),
                    },
                ]).split
            );
            const afterRun = setEqBypassed(context, firstLayers(24), true);

            expect(slices.map((slice) => slice.commands.length)).toEqual([24, 24, 12]);
            expect(replayLaterSlice(slices, 2, afterRun)).toMatchObject({ status: 'accepted' });
            expect(replayLaterSlice(slices, 2, setEqBypassed(afterRun, onLayer(26), true))).toMatchObject({
                status: 'rejected',
            });
        });

        it('revalidates at approval a later batch whose set the run changed, and refuses an outside change', () => {
            const slices = requireSlices(splitBulk(context, [muteLayers, soloUnmuted]).split);
            const afterRun = mutedThrough(context, 24);
            const rebased = rebaseBulkSetSliceEvidence({
                evidence: slices[1]!,
                context: afterRun,
                revision: LATER_REVISION,
                earlierCommands: slices[0]!.commands,
                recordedFingerprints: recordedFingerprints(slices),
            });
            if (rebased.status === 'rejected') {
                throw new Error(rebased.reason);
            }
            const records = deriveMatchSelectorPredicates(rebased.evidence);
            const contextSpy = vi.mocked(getProjectContext);

            contextSpy.mockReturnValueOnce(afterRun);
            expect(revalidateApprovedMatchSelectors(records)).toEqual({ status: 'unchanged' });
            contextSpy.mockReturnValueOnce({
                ...afterRun,
                tracks: afterRun.tracks.map((track) =>
                    track.id === layers[26]!.id ? { ...track, muted: true } : track
                ),
            });
            expect(revalidateApprovedMatchSelectors(records)).toMatchObject({ status: 'invalidated' });
        });

        it('still refuses a later batch whose set someone else changed by muting a member', () => {
            const slices = requireSlices(splitBulk(context, [muteLayers, soloUnmuted]).split);
            const afterRun = mutedThrough(context, 24);
            const userMuted = {
                ...afterRun,
                tracks: afterRun.tracks.map((track) =>
                    track.id === layers[26]!.id ? { ...track, muted: true } : track
                ),
            };

            expect(replayLaterSlice(slices, 2, userMuted)).toMatchObject({ status: 'rejected' });
        });
    });

    it('refuses a schedule whose remaining batches exceed the run command budget', () => {
        expect(
            planAgentRun({
                request: 'Mute every layer track',
                revision: BULK_REVISION,
                actions: [{ type: 'muteTrack' }],
                actionLabels: ['Mute Layer 1'],
                scope: {
                    targetIds: ['track-layer-001'],
                    targetRanges: [],
                    protectedTargetIds: [],
                    protectedRanges: [],
                },
                grants: {
                    allowedOperationPrefixes: ['muteTrack'],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: false,
                },
                budgets: { limits: { maxCommands: 40 }, consumed: { maxCommands: 24 } },
                requiresConfirmation: true,
                scheduledCommandCount: 17,
            })
        ).toEqual({
            status: 'rejected',
            reason: "The scheduled batches need 17 commands, more than the 16 this run's maxCommands budget has left.",
        });
    });

    describe('a run whose request spans two batches', () => {
        beforeEach(() => {
            agentRunLifecycle.clear();
        });

        afterEach(() => {
            agentRunLifecycle.clear();
        });

        function recordScheduledPlan(runId: string) {
            const slices = requireSlices(splitBulk(context, [muteLayers]).split);
            const scope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
            agentRunLifecycle.create({
                runId,
                request: 'Mute every layer track',
                mode: 'apply',
                createdRevision: BULK_REVISION,
            });
            agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
            agentRunLifecycle.recordPlan({
                runId,
                summary: 'Mute 24 layers',
                commandIds: ['command-1'],
                serializedBatchIdentity: 'batch-1',
                revision: BULK_REVISION,
                scope,
                grants: {
                    allowedOperationPrefixes: ['muteTrack'],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: false,
                },
                budgets: { limits: {}, consumed: {} },
            });
            const plan = agentRunLifecycle.get(runId)!.plan!;
            const batchSchedule = {
                schemaVersion: 1 as const,
                scheduleId: 'schedule-1',
                position: 1,
                total: 2,
                totalCommands: 30,
                interactionMode: 'apply' as const,
                trustCeiling: null,
                serializedProviderProposal: null,
                slices: slices.map((slice, index) => ({
                    position: index + 1,
                    commandCount: slice.commands.length,
                    targetIds: slice.providerKnownTargetIds,
                    serializedSlice: JSON.stringify(slice),
                })),
            };
            agentRunLifecycle.recordPlan({
                runId,
                summary: plan.summary,
                commandIds: plan.commandIds,
                serializedBatchIdentity: plan.serializedBatchIdentity,
                revision: BULK_REVISION,
                scope,
                grants: agentRunLifecycle.get(runId)!.grants,
                budgets: { limits: {}, consumed: {} },
                plan: { ...plan, batchSchedule },
            });
            agentRunLifecycle.recordBatch({
                runId,
                batch: { batchId: 'batch-1', commandIds: ['command-1'], status: 'executing', receiptIdentity: null },
            });
            agentRunLifecycle.transitionPhase({ runId, phase: 'executing' });
            return batchSchedule;
        }

        it('does not complete the run when its first batch commits', () => {
            recordScheduledPlan('run-two-batches');

            agentRunLifecycle.recordCommittedWork({
                runId: 'run-two-batches',
                workId: 'batch-1',
                receiptIdentity: 'receipt-1',
                completesRun: true,
            });

            expect(agentRunLifecycle.get('run-two-batches')?.phase).toBe('executing');
            agentRunLifecycle.transitionPhase({ runId: 'run-two-batches', phase: 'completed' });
            expect(agentRunLifecycle.get('run-two-batches')?.phase).toBe('executing');
        });

        it('holds a request to complete the run while a later batch is owed', () => {
            recordScheduledPlan('run-held');

            agentRunLifecycle.transitionPhase({ runId: 'run-held', phase: 'completed' });

            expect(agentRunLifecycle.get('run-held')?.phase).toBe('executing');
        });

        it('does not complete the run when its first batch settles as a no-op', () => {
            recordScheduledPlan('run-no-op');
            const claimed = agentRunLifecycle.claimWorkLease({
                runId: 'run-no-op',
                workId: 'batch-1',
                ownerKind: 'command',
                cleanupOwner: 'command-executor',
                idempotencyKey: 'batch-1-key',
                receiptIdentity: 'batch-1-receipt',
                idempotent: true,
                retriable: false,
            });
            if (claimed.status !== 'claimed') {
                throw new Error('Expected the first batch to be claimed');
            }

            expect(
                agentRunLifecycle.settleWorkLeaseAndTerminalize({
                    runId: 'run-no-op',
                    workId: 'batch-1',
                    leaseId: claimed.lease.leaseId,
                    cancellationGeneration: claimed.lease.cancellationGeneration,
                    idempotencyKey: claimed.lease.idempotencyKey,
                    receiptIdentity: claimed.lease.receiptIdentity,
                    outcome: 'no-op',
                })
            ).toEqual({ status: 'settled' });
            expect(agentRunLifecycle.get('run-no-op')).toMatchObject({
                phase: 'executing',
                batches: [{ batchId: 'batch-1', status: 'no-op' }],
            });
        });

        it('keeps the schedule through a store round trip', () => {
            const batchSchedule = recordScheduledPlan('run-round-trip');
            // The run state persists as JSON, so the schedule must survive being written as text.
            const persistedText = JSON.stringify(readAgentRunState());
            const restored = sanitizeAgentRunState(JSON.parse(persistedText));

            expect(restored.runs.find((run) => run.runId === 'run-round-trip')?.plan?.batchSchedule).toEqual(
                batchSchedule
            );
        });
    });
});

const LAYER_COUNT = 26;
const MUTE_LAYERS_PROMPT = 'Mute all layer tracks';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

async function seedLayerTracks(): Promise<string[]> {
    for (let index = 0; index < LAYER_COUNT; index += 1) {
        await executeAppAction({ type: 'addTrack', payload: { name: `Layer ${String(index + 1)}`, kind: 'audio' } });
    }
    return (trackStore.value?.tracks ?? []).map((track) => track.id);
}

/** One intent wide enough that the index page carries muteTrack among its matches. */
const MUTE_SEARCH_CALL = {
    name: 'agent.command-index.search',
    arguments: { intent: 'mute track', page: { limit: 8 } },
};

function muteLayersItem() {
    return {
        id: 'mute-layers',
        name: 'muteTrack',
        arguments: { muted: true },
        selector: matchTracks('layer', LAYER_COUNT),
    };
}

function scriptMuteLayersProposal(item: Record<string, unknown> = muteLayersItem()): void {
    scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
        () => [MUTE_SEARCH_CALL],
        discoverSearchedCalls(['muteTrack']),
        proposeDiscoveredCalls([item], ['muteTrack']),
    ]);
}

async function requestMuteLayers(options?: { mode: 'preview' }): Promise<void> {
    flushAutomergeStorageWrites();
    await sendChatMessage(MUTE_LAYERS_PROMPT, options);
}

function proposedConfirmations() {
    return (pendingActionConfirmationStore.value?.confirmations ?? []).filter(
        (confirmation) => confirmation.status === 'proposed'
    );
}

function requireOnlyProposedConfirmation() {
    const proposed = proposedConfirmations();
    if (proposed.length !== 1) {
        throw new Error(`Expected exactly one proposed confirmation, found ${String(proposed.length)}`);
    }
    return proposed[0]!;
}

function mutedTrackIds(): string[] {
    return (trackStore.value?.tracks ?? []).filter((track) => track.muted).map((track) => track.id);
}

describe('a bulk request confirmed one batch at a time', () => {
    beforeEach(async () => {
        Container.clear();
        configureAiWorkflowCommandPreflightFixture();
        runtimeMocks.generateWebLlmCompletion.mockReset();
        await cloudSession.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('bulk set commands test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(emptyMidiState());
        automationStore.set({ lanes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        clearUndoHistory();
        resetAiWorkflowCommandPreflightFixture();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set(emptyMidiState());
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
    });

    it('proposes the second batch for its own approval once the first commits, then completes the run', async () => {
        const layerIds = await seedLayerTracks();
        scriptMuteLayersProposal();

        await requestMuteLayers();
        const first = requireOnlyProposedConfirmation();
        expect(first.approvalSnapshot.batchPosition).toEqual({ index: 1, total: 2 });
        expect(first.actions).toHaveLength(MAX_LLM_ACTIONS_PER_BATCH);

        await expect(confirmPendingChatActions({ confirmationId: first.id })).resolves.toEqual({ status: 'executed' });
        expect(mutedTrackIds()).toEqual(layerIds.slice(0, MAX_LLM_ACTIONS_PER_BATCH));
        expect(agentRunLifecycle.get(first.runId)?.phase).toBe('waiting-for-approval');
        const second = requireOnlyProposedConfirmation();
        expect(second.runId).toBe(first.runId);
        expect(second.approvalSnapshot.batchPosition).toEqual({ index: 2, total: 2 });
        expect(getAgentApprovalView({ confirmationId: second.id })?.batchPosition).toEqual({ index: 2, total: 2 });

        await expect(confirmPendingChatActions({ confirmationId: second.id })).resolves.toEqual({ status: 'executed' });
        expect(mutedTrackIds()).toEqual(layerIds);
        expect(agentRunLifecycle.get(first.runId)?.phase).toBe('completed');
        expect(proposedConfirmations()).toEqual([]);
    });

    it('refuses at approval a later batch whose where-only set gained a member while it waited', async () => {
        const layerIds = await seedLayerTracks();
        scriptMuteLayersProposal({
            ...muteLayersItem(),
            selector: {
                targetArgument: 'trackId',
                entity: 'track',
                where: { kind: 'audio' },
                quantity: { unit: 'targets', exactly: LAYER_COUNT },
            },
        });
        await requestMuteLayers();
        const first = requireOnlyProposedConfirmation();
        await expect(confirmPendingChatActions({ confirmationId: first.id })).resolves.toEqual({ status: 'executed' });
        const second = requireOnlyProposedConfirmation();

        await executeAppAction({ type: 'addTrack', payload: { name: 'Layer 27', kind: 'audio' } });
        const approval = await confirmPendingChatActions({ confirmationId: second.id });

        expect(approval).toMatchObject({ status: 'invalidated' });
        expect(mutedTrackIds()).toEqual(layerIds.slice(0, MAX_LLM_ACTIONS_PER_BATCH));
        expect(agentRunLifecycle.get(first.runId)?.phase).not.toBe('completed');
    });

    it('refuses a later batch whose target someone else changed and leaves the run partially completed', async () => {
        const layerIds = await seedLayerTracks();
        scriptMuteLayersProposal();
        await requestMuteLayers();
        const first = requireOnlyProposedConfirmation();
        const changedTargetId = layerIds.at(-1)!;

        // The set keeps every member, so the first batch still matches it and only asks to be
        // approved again; the second batch's own target is what changed.
        await executeAppAction({ type: 'renameTrack', payload: { trackId: changedTargetId, name: 'Layer 26 Lead' } });
        const firstAttempt = await confirmPendingChatActions({ confirmationId: first.id });
        expect(firstAttempt).toMatchObject({ status: 'reapproval_required' });
        await expect(confirmPendingChatActions({ confirmationId: first.id })).resolves.toEqual({ status: 'executed' });

        expect(mutedTrackIds()).toEqual(layerIds.slice(0, MAX_LLM_ACTIONS_PER_BATCH));
        expect(proposedConfirmations()).toEqual([]);
        expect(agentRunLifecycle.get(first.runId)?.phase).toBe('partially-completed');
        const refusal = chatStore.value?.messages.at(-1)?.content ?? '';
        expect(refusal).toMatch(
            /^Batch 2 of 2 was not proposed: .*preconditions no longer hold\. Batch 1 remains applied\.$/u
        );
        expect(getPendingActionConfirmation(first.id)?.status).toBe('executed');
    });

    it('refuses to preview a request that spans several batches', async () => {
        await seedLayerTracks();
        scriptMuteLayersProposal();

        await requestMuteLayers({ mode: 'preview' });

        expect(proposedConfirmations()).toEqual([]);
        expect(mutedTrackIds()).toEqual([]);
        expect(chatStore.value?.messages.at(-1)?.content).toBe(
            'Command not executed: This request runs as 2 successive batches, which only apply mode can run one approval at a time.'
        );
    });

    it('refuses a list larger than one batch that shares its turn with a specialized workflow', async () => {
        await seedLayerTracks();
        cycleProviderAttempt(runtimeMocks.generateWebLlmCompletion, [
            () => [MUTE_SEARCH_CALL],
            discoverSearchedCalls(['muteTrack']),
            (message) => [
                { name: WORKFLOW_CAPABILITY_TOOL_NAME, arguments: { capabilityId: WORKFLOW_CAPABILITY_IDS[0] } },
                ...proposeDiscoveredCalls([muteLayersItem()], ['muteTrack'])(message),
            ],
        ]);

        await requestMuteLayers();

        expect(proposedConfirmations()).toEqual([]);
        expect(mutedTrackIds()).toEqual([]);
        expect(chatStore.value?.messages.at(-1)?.content).toBe(
            'Command not executed: Provider action rejected: A list larger than one batch cannot share its turn with a specialized workflow or another request.'
        );
    });

    it('refuses a request that spans several batches from the prompt bar', async () => {
        await seedLayerTracks();
        scriptMuteLayersProposal();
        flushAutomergeStorageWrites();

        const submitted = await submitAdmittedPromptRequest({ prompt: MUTE_LAYERS_PROMPT, source: 'prompt-bar' });

        expect(submitted.status).toBe('rejected');
        expect(proposedConfirmations()).toEqual([]);
        expect(mutedTrackIds()).toEqual([]);
    });
});
