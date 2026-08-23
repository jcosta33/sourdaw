import {
    getExecutableAppActionGroundingCatalog,
    getExecutableAppActionGroundingRules,
} from '#/modules/Command/useCases';
import { createPunchRegionPatch } from '#/modules/Transport/useCases';

import { type ActionCommandGraph } from '../../models/ActionCommandGraph';
import { type AgentRunScope } from '../../models/AgentRun';
import { type ProjectContext } from '../../models/ProjectContext';
import { type WorkflowCapabilityId } from '../../models/WorkflowCapability';
import {
    bridgeLlmToolCalls,
    type LlmActionBridgeResult,
    type LlmActionRejection,
    type MarkerPlanningSignature,
    type SectionPlanningSignature,
} from '../../transformers/llmActionBridge';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../../transformers/llmActionLimits';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';
import { type ArbitraryCommandListEvidence } from '../compileArbitraryCommandList';
import {
    type CompilerResolvedTargetOverride,
    validateArbitraryCommandListEvidence,
} from '../validateArbitraryCommandListEvidence';

import { type BatchLocalActionIdentity } from './BatchLocalActionIdentity';
import { bridgeBackingVocalPlatePlan } from './bridgeBackingVocalPlatePlan';
import { bridgeDrumRenderComparisonPlan } from './bridgeDrumRenderComparisonPlan';
import { bridgeSharedVocalFxBusesPlan } from './bridgeSharedVocalFxBusesPlan';
import { getArticulationTransferPromptScope } from './getArticulationTransferPromptScope';
import {
    getBassProcessingCopyPromptScope,
    type BassProcessingCopyRequestScope,
} from './getBassProcessingCopyPromptScope';
import { getBulkDeviceInsertionTrackScope } from './getBulkDeviceInsertionTrackScope';
import { getDeviceParameterPromptScope } from './getDeviceParameterPromptScope';
import {
    getDrumPreviewBranchesPromptScope,
    type DrumPreviewBranchesRequestScope,
} from './getDrumPreviewBranchesPromptScope';
import { getDrumRoutingPromptScope } from './getDrumRoutingPromptScope';
import {
    getMidiOverlapTransformPromptScope,
    type MidiOverlapTransformRequestScope,
} from './getMidiOverlapTransformPromptScope';
import { getMutedEmptyTrackDeletionScope } from './getMutedEmptyTrackDeletionScope';
import { getSidechainRoutingPromptScope } from './getSidechainRoutingPromptScope';
import {
    getSyncopatedArpeggioPromptScope,
    type SyncopatedArpeggioRequestScope,
} from './getSyncopatedArpeggioPromptScope';
import { getWholeProjectVibeMixScope } from './getWholeProjectVibeMixScope';
import { resolveAgentReference } from './resolveAgentReference';

type BridgeGroundedLlmToolCallsInput = {
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    markerSignatures?: readonly MarkerPlanningSignature[];
    sectionSignatures?: readonly SectionPlanningSignature[];
    prompt: string;
    compilerEvidence?: ArbitraryCommandListEvidence;
    projectRevision?: string;
    workflowCapabilityId?: WorkflowCapabilityId;
};

type GroundToolCallInput = {
    actionOrdinal: number;
    batchLocalBusBindings: ReadonlyMap<string, BatchLocalBusBinding>;
    call: ToolCallResult;
    catalog: GroundingCatalog;
    context: ProjectContext;
    declaredBatchLocalBusBindings: ReadonlyMap<string, BatchLocalBusBinding>;
    index: number;
    prompt: string;
    plannedActionNames: readonly string[];
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[];
    sameActionCallCount: number;
    resolvedTargetOverrides?: readonly CompilerResolvedTargetOverride[];
    visibleGroundedCalls: readonly ToolCallResult[];
    visiblePlannedTrackCreations: readonly ToolCallResult[];
    workflowCapabilityId?: WorkflowCapabilityId;
};

type PromptClause = {
    masked: string;
    text: string;
};

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;
type GroundingRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>;

type BridgeGroundedLlmToolCallsResult = LlmActionBridgeResult & {
    appOwnedRenderTailSeconds?: number;
    bassProcessingCopyScope?: BassProcessingCopyRequestScope;
    midiOverlapTransformScope?: MidiOverlapTransformRequestScope;
    drumPreviewBranchesScope?: DrumPreviewBranchesRequestScope;
    syncopatedArpeggioScope?: SyncopatedArpeggioRequestScope;
    batchLocalActionIdentities?: BatchLocalActionIdentity[];
    actionCommandGraph?: ActionCommandGraph;
    verifiedProviderProposalScope?: AgentRunScope;
};

type BatchLocalBusBinding = Extract<BatchLocalActionIdentity, { actionType: 'createBus' }> & {
    binding: string;
    callIndex: number;
    name: string;
};

type PlannedTrackName = {
    callIndex: number;
    isBoundBus: boolean;
    name: string;
};

type CollectBatchLocalBusBindingsResult =
    | {
          status: 'accepted';
          bindingsByCallIndex: ReadonlyMap<number, BatchLocalBusBinding>;
          bindingsByName: ReadonlyMap<string, BatchLocalBusBinding>;
      }
    | { status: 'rejected'; rejection: LlmActionRejection };

type ResolveBatchLocalBusReferenceResult =
    { status: 'none' } | { status: 'resolved'; binding: BatchLocalBusBinding } | { status: 'rejected'; reason: string };

function hasExactTargetIdSet(assertedIds: unknown, expectedIds: readonly string[]): boolean {
    if (!Array.isArray(assertedIds)) {
        return false;
    }
    const assertedIdSet = new Set(assertedIds);
    return assertedIdSet.size === expectedIds.length && expectedIds.every((targetId) => assertedIdSet.has(targetId));
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value as Readonly<Record<string, unknown>>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

function hasExactCanonicalToolCallOrder(
    expected: readonly ToolCallResult[],
    actual: readonly ToolCallResult[]
): boolean {
    return (
        expected.length === actual.length &&
        expected.every((expectedCall, index) => canonicalJson(expectedCall) === canonicalJson(actual[index]))
    );
}

type ActionPromptScope = PromptClause & {
    directional: boolean;
    matchedIntentPhrase: string;
};

type ResolveActionPromptScopeInput = {
    actionName: string;
    actionOrdinal: number;
    assertedArguments: Readonly<Record<string, unknown>>;
    catalog: GroundingCatalog;
    compilerExpandedTargets?: boolean;
    context: ProjectContext;
    prompt: string;
    plannedActionNames: readonly string[];
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[];
    sameActionCallCount: number;
    workflowCapabilityId?: WorkflowCapabilityId;
};

type DirectionalTargetReferences = {
    direct: readonly string[];
    owners: readonly string[];
};

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}

const BATCH_LOCAL_BINDING_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const batchLocalBusCapabilities: ReadonlySet<string> = new Set([
    'track',
    'armable-track',
    'duplicable-track',
    'removable-track',
    'routable-source',
    'bus',
    'output',
    'device-host-track',
]);

function namesOverlap(left: string, right: string): boolean {
    const normalizedLeft = normalizePromptText(left);
    const normalizedRight = normalizePromptText(right);
    return (
        ` ${normalizedLeft} `.includes(` ${normalizedRight} `) || ` ${normalizedRight} `.includes(` ${normalizedLeft} `)
    );
}

function collectPlannedTrackNames(calls: readonly ToolCallResult[]): PlannedTrackName[] {
    const plannedTrackNames: PlannedTrackName[] = [];
    for (const [callIndex, call] of calls.entries()) {
        if (call.name !== 'createBus' && call.name !== 'addTrack') {
            continue;
        }
        const name = normalizeSafeProjectName(call.arguments.name);
        if (!name) {
            continue;
        }
        plannedTrackNames.push({
            callIndex,
            isBoundBus: call.name === 'createBus' && call.arguments.binding !== undefined,
            name,
        });
    }
    return plannedTrackNames;
}

function collectBatchLocalBusBindings(
    calls: readonly ToolCallResult[],
    context: ProjectContext
): CollectBatchLocalBusBindingsResult {
    const bindingsByCallIndex = new Map<number, BatchLocalBusBinding>();
    const bindingsByName = new Map<string, BatchLocalBusBinding>();
    const plannedTrackNames = collectPlannedTrackNames(calls);
    const reservedBusNames = new Set(context.tracks.map((track) => normalizePromptText(track.name)));
    let createBusOrdinal = 0;

    for (const [callIndex, call] of calls.entries()) {
        if (call.name !== 'createBus') {
            continue;
        }
        const actionOrdinal = createBusOrdinal;
        createBusOrdinal += 1;
        if (call.arguments.binding === undefined) {
            continue;
        }
        if (typeof call.arguments.binding !== 'string' || !BATCH_LOCAL_BINDING_PATTERN.test(call.arguments.binding)) {
            return {
                status: 'rejected',
                rejection: rejection(
                    callIndex,
                    call.name,
                    'Batch-local bus binding must start with a lowercase letter and contain at most 64 lowercase letters, digits, or hyphens'
                ),
            };
        }
        if (bindingsByName.has(call.arguments.binding)) {
            return {
                status: 'rejected',
                rejection: rejection(
                    callIndex,
                    call.name,
                    `Duplicate batch-local bus binding: ${call.arguments.binding}`
                ),
            };
        }
        const name = normalizeSafeProjectName(call.arguments.name);
        if (!name) {
            return {
                status: 'rejected',
                rejection: rejection(callIndex, call.name, 'A bound bus requires one safe bus name'),
            };
        }
        const normalizedName = normalizePromptText(name);
        const collidingUnboundTrack = plannedTrackNames.find(
            (plannedTrack) =>
                plannedTrack.callIndex !== callIndex &&
                !plannedTrack.isBoundBus &&
                namesOverlap(name, plannedTrack.name)
        );
        if (collidingUnboundTrack) {
            return {
                status: 'rejected',
                rejection: rejection(
                    callIndex,
                    call.name,
                    `Bound bus name collides with an unbound planned track: ${collidingUnboundTrack.name}`
                ),
            };
        }
        if (reservedBusNames.has(normalizedName)) {
            return {
                status: 'rejected',
                rejection: rejection(
                    callIndex,
                    call.name,
                    `Bound bus name collides with an existing or earlier planned track: ${name}`
                ),
            };
        }
        reservedBusNames.add(normalizedName);
        const binding: BatchLocalBusBinding = {
            actionOrdinal,
            actionType: 'createBus',
            binding: call.arguments.binding,
            busId: `bus-ai-${crypto.randomUUID()}`,
            callIndex,
            name,
        };
        bindingsByCallIndex.set(callIndex, binding);
        bindingsByName.set(binding.binding, binding);
    }

    return { status: 'accepted', bindingsByCallIndex, bindingsByName };
}

function resolveBatchLocalBusReference(
    assertedValue: unknown,
    callIndex: number,
    visibleBindings: ReadonlyMap<string, BatchLocalBusBinding>,
    declaredBindings: ReadonlyMap<string, BatchLocalBusBinding>
): ResolveBatchLocalBusReferenceResult {
    if (typeof assertedValue !== 'string' || !assertedValue.startsWith('$')) {
        return { status: 'none' };
    }
    const bindingName = assertedValue.slice(1);
    if (!BATCH_LOCAL_BINDING_PATTERN.test(bindingName)) {
        return { status: 'rejected', reason: `Malformed batch-local bus reference: ${assertedValue}` };
    }
    const visible = visibleBindings.get(bindingName);
    if (visible) {
        return { status: 'resolved', binding: visible };
    }
    const declared = declaredBindings.get(bindingName);
    if (declared && declared.callIndex > callIndex) {
        return { status: 'rejected', reason: `Forward batch-local bus reference is not allowed: ${assertedValue}` };
    }
    return { status: 'rejected', reason: `Unknown batch-local bus reference: ${assertedValue}` };
}

function containsBatchLocalBusEvidence(
    targetPrompt: string,
    binding: BatchLocalBusBinding,
    capability: GroundingRules['targetRules'][number]['capability'],
    context: ProjectContext,
    visibleBindings: ReadonlyMap<string, BatchLocalBusBinding>,
    visibleGroundedCalls: readonly ToolCallResult[],
    visiblePlannedTrackCreations: readonly ToolCallResult[]
): boolean {
    const normalizedPrompt = normalizePromptText(targetPrompt);
    const normalizedName = normalizePromptText(binding.name);
    const hasBusAnaphora = /\b(?:that bus|this bus|the new bus|new bus|newly created bus|created bus)\b/u.test(
        normalizedPrompt
    );
    const hasAnaphora = hasBusAnaphora || /\bit\b/u.test(normalizedPrompt);
    const hasQualifiedName = [
        ` to ${normalizedName} `,
        ` into ${normalizedName} `,
        ` on ${normalizedName} `,
        ` onto ${normalizedName} `,
        ` through ${normalizedName} `,
        ` in ${normalizedName} `,
        ` ${normalizedName} bus `,
        ` ${normalizedName} track `,
    ].some((phrase) => ` ${normalizedPrompt} `.includes(phrase));
    if (!hasAnaphora || hasQualifiedName) {
        const explicitReference = resolveAgentReference({
            prompt: targetPrompt,
            assertedId: binding.busId,
            capability,
            context,
        });
        if (explicitReference.status === 'resolved') {
            return true;
        }
        if (explicitReference.reason !== 'ungrounded-target') {
            return false;
        }
    }
    if (!hasAnaphora) {
        return false;
    }
    const anaphoraCapability = hasBusAnaphora ? 'output' : capability;
    const candidateIds = new Set([...visibleBindings.values()].map((visibleBinding) => visibleBinding.busId));
    for (const groundedCall of visibleGroundedCalls) {
        const rules = getExecutableAppActionGroundingRules(groundedCall.name);
        if (!rules) {
            continue;
        }
        for (const targetRule of rules.targetRules) {
            const assertedId = groundedCall.arguments[targetRule.argument];
            if (typeof assertedId !== 'string' || !isCompatibleTargetId(assertedId, anaphoraCapability, context)) {
                continue;
            }
            candidateIds.add(assertedId);
        }
    }
    const compatibleCreationCount = countCompatiblePlannedTrackCreations(
        visiblePlannedTrackCreations,
        anaphoraCapability
    );
    const unknownCreationCount = compatibleCreationCount - visibleBindings.size;
    return unknownCreationCount === 0 && candidateIds.size === 1 && candidateIds.has(binding.busId);
}

function isCompatibleTargetId(
    id: string,
    capability: GroundingRules['targetRules'][number]['capability'],
    context: ProjectContext
): boolean {
    const prompt = capability === 'output' && id === 'master' ? 'to master output' : id;
    return resolveAgentReference({ prompt, assertedId: id, capability, context }).status === 'resolved';
}

function countCompatiblePlannedTrackCreations(
    calls: readonly ToolCallResult[],
    capability: GroundingRules['targetRules'][number]['capability']
): number {
    return calls.filter((call) => {
        if (call.name === 'createBus') {
            return batchLocalBusCapabilities.has(capability);
        }
        if (call.name !== 'addTrack' || typeof call.arguments.kind !== 'string') {
            return false;
        }
        if (capability === 'track' || capability === 'armable-track' || capability === 'removable-track') {
            return true;
        }
        if (capability === 'duplicable-track' || capability === 'device-host-track') {
            return call.arguments.kind !== 'vca';
        }
        if (capability === 'routable-source') {
            return call.arguments.kind === 'audio' || call.arguments.kind === 'midi' || call.arguments.kind === 'bus';
        }
        if (capability === 'bus' || capability === 'output') {
            return call.arguments.kind === 'bus';
        }
        return false;
    }).length;
}

function createProjectedBus(context: ProjectContext, binding: BatchLocalBusBinding): ProjectContext['tracks'][number] {
    return {
        id: binding.busId,
        name: binding.name,
        kind: 'bus',
        muted: false,
        soloed: false,
        soloSafe: true,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        outputId: context.tracks.find((track) => track.kind === 'master')?.id,
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

function stripBatchLocalBinding(call: ToolCallResult): ToolCallResult {
    if (call.name !== 'createBus' || call.arguments.binding === undefined) {
        return call;
    }
    const args = { ...call.arguments };
    delete args.binding;
    return { ...call, arguments: args };
}

function normalizePromptText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

type ClauseActionIntent = {
    actionType: string;
    index: number;
    phrase: string;
};

function getIntentPhraseIndex(text: string, intentPhrase: string): number {
    const normalizedText = ` ${normalizePromptText(text)} `;
    return normalizedText.indexOf(` ${normalizePromptText(intentPhrase)} `);
}

function isNegatedIntent(text: string, intentPhrase: string): boolean {
    const normalizedText = normalizePromptText(text);
    const normalizedPhrase = normalizePromptText(intentPhrase);
    const phraseIndex = normalizedText.indexOf(normalizedPhrase);
    if (phraseIndex < 0) {
        return false;
    }
    const prefix = normalizedText.slice(0, phraseIndex);
    return /\b(?:do not|don t|dont|never|not)\b/u.test(prefix);
}

type CancellationCue = {
    index: number;
    text: string;
};

function getCancellationCues(text: string): CancellationCue[] {
    const patterns = [
        /\b(?:never mind|on second thought|actually\s*,?\s+no)\b/gu,
        /\b(?:abort|cancel|disregard|scratch)\s+(?:it\b|(?:that|this)\b(?!\s+\p{L})|(?:the|that|this)\s+(?:\p{L}+\s+){0,2}(?:change|command|request)\b)/gu,
        /\bleave\s+(?:(?:it|that|this)\s+)?unchanged\b/gu,
        /\b(?:do not|don['’]t|don t|dont|never|not)\b(?:\s+\p{L}+){0,3}\s+(?:apply|change|do|execute|make)\s+(?:it\b|(?:that|this)\b(?!\s+\p{L})|(?:the|that|this)\s+(?:\p{L}+\s+){0,2}(?:change|command|request)\b)/gu,
    ];
    return patterns.flatMap((pattern) =>
        [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[0] }))
    );
}

function getReferencedCancellationAction(cue: CancellationCue, catalog: GroundingCatalog): string | null {
    const matches = catalog
        .flatMap((entry) =>
            entry.intentPhrases
                .filter((phrase) => !isGenericDeviceIntent(phrase) && getIntentPhraseIndex(cue.text, phrase) >= 0)
                .map((phrase) => ({ actionType: entry.actionType, phrase }))
        )
        .sort((left, right) => normalizePromptText(right.phrase).length - normalizePromptText(left.phrase).length);
    const first = matches[0];
    const second = matches[1];
    if (!first) {
        return null;
    }
    if (
        second &&
        normalizePromptText(second.phrase).length === normalizePromptText(first.phrase).length &&
        second.actionType !== first.actionType
    ) {
        return null;
    }
    return first.actionType;
}

function getNearestIntentAction(
    text: string,
    catalog: GroundingCatalog,
    beforeIndex: number,
    plannedActionNames: readonly string[]
): string | null {
    const prefix = text.slice(0, beforeIndex);
    const plannedCatalog = catalog.filter((entry) => plannedActionNames.includes(entry.actionType));
    let actionType: string | null = null;
    for (const clause of getPromptClauses(prefix, prefix)) {
        const intent = resolveClauseActionIntent(clause.masked, plannedCatalog);
        if (intent) {
            actionType = intent.actionType;
        }
    }
    return actionType;
}

function hasTrailingIntentCancellation(
    text: string,
    actionName: string,
    catalog: GroundingCatalog,
    plannedActionNames: readonly string[]
): boolean {
    const searchableText = text.toLocaleLowerCase();
    return getCancellationCues(searchableText).some((cue) => {
        const referencedAction = getReferencedCancellationAction(cue, catalog);
        const cancelledAction =
            referencedAction ?? getNearestIntentAction(searchableText, catalog, cue.index, plannedActionNames);
        return cancelledAction === actionName;
    });
}

const genericDeviceIntentPhrases: ReadonlySet<string> = new Set(['adjust', 'change', 'decrease', 'increase', 'set']);

function isGenericDeviceIntent(phrase: string): boolean {
    return genericDeviceIntentPhrases.has(normalizePromptText(phrase));
}

type ExplicitTrackDeletionScopeInput = {
    context: ProjectContext;
    text: string;
    trackId: unknown;
};

function isExplicitTrackDeletionScope({ context, text, trackId }: ExplicitTrackDeletionScopeInput): boolean {
    if (typeof trackId !== 'string') {
        return false;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.kind === 'master') {
        return false;
    }
    const normalizedTrackReferences = new Set([normalizePromptText(track.id), normalizePromptText(track.name)]);
    const hasNonTrackReferenceCollision = context.tracks.some(
        (candidateTrack) =>
            candidateTrack.clips.some(
                (clip) =>
                    normalizedTrackReferences.has(normalizePromptText(clip.id)) ||
                    normalizedTrackReferences.has(normalizePromptText(clip.name))
            ) ||
            candidateTrack.devices.some(
                (device) =>
                    normalizedTrackReferences.has(normalizePromptText(device.id)) ||
                    normalizedTrackReferences.has(normalizePromptText(device.type))
            )
    );
    if (hasNonTrackReferenceCollision && !/\btrack\b/u.test(normalizePromptText(text))) {
        return false;
    }

    let commandText = text;
    const targetReferences = [track.id, track.name].sort((left, right) => right.length - left.length);
    for (const reference of targetReferences) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu');
        commandText = commandText.replaceAll(pattern, ' ');
    }
    commandText = normalizePromptText(commandText);
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/u, '');
    commandText = commandText.replace(/^please\s+/u, '');
    return /^(?:delete|remove)(?: the)?(?: (?:selected|current|this)(?: (?:audio|midi|bus|folder))?)?(?: track)?(?: from (?:the )?project)?$/u.test(
        commandText
    );
}

type ExplicitClipDeletionScopeInput = {
    context: ProjectContext;
    text: string;
    clipId: unknown;
};

function isExplicitClipDeletionScope({ context, text, clipId }: ExplicitClipDeletionScopeInput): boolean {
    if (typeof clipId !== 'string') {
        return false;
    }
    const clip = context.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!clip) {
        return false;
    }
    const normalizedClipReferences = new Set([normalizePromptText(clip.id), normalizePromptText(clip.name)]);
    const hasNonClipReferenceCollision = context.tracks.some(
        (track) =>
            normalizedClipReferences.has(normalizePromptText(track.id)) ||
            normalizedClipReferences.has(normalizePromptText(track.name)) ||
            track.devices.some(
                (device) =>
                    normalizedClipReferences.has(normalizePromptText(device.id)) ||
                    normalizedClipReferences.has(normalizePromptText(device.type))
            )
    );
    if (hasNonClipReferenceCollision && !/\bclip\b/u.test(normalizePromptText(text))) {
        return false;
    }

    let commandText = text;
    const targetReferences = [clip.id, clip.name].sort((left, right) => right.length - left.length);
    for (const reference of targetReferences) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu');
        commandText = commandText.replaceAll(pattern, ' ');
    }
    commandText = normalizePromptText(commandText);
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/u, '');
    commandText = commandText.replace(/^please\s+/u, '');
    return /^(?:delete|remove)(?: the)?(?: (?:selected|current|this)(?: (?:audio|midi))?)?(?: clip)?(?: from (?:the )?project)?$/u.test(
        commandText
    );
}

function isExplicitCommandClause(maskedText: string, catalog: GroundingCatalog): boolean {
    let commandSource = maskedText.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    if (/^["'“”‘’]/u.test(commandSource)) {
        return false;
    }
    const commandText = normalizePromptText(commandSource);
    if (commandText.startsWith('make ')) {
        return true;
    }
    return catalog.some((entry) =>
        entry.intentPhrases.some((phrase) => {
            const normalizedPhrase = normalizePromptText(phrase);
            if (commandText === normalizedPhrase) {
                return true;
            }
            if (!commandText.startsWith(`${normalizedPhrase} `)) {
                return false;
            }
            const suffix = commandText.slice(normalizedPhrase.length).trim();
            return !/^(?:is|means|seems|sounds|was|were)\b/u.test(suffix);
        })
    );
}

function resolveClauseActionIntent(
    maskedText: string,
    catalog: GroundingCatalog,
    expectedActionType?: string
): ClauseActionIntent | null {
    if (!isExplicitCommandClause(maskedText, catalog)) {
        return null;
    }
    const matches = catalog
        .flatMap((entry) =>
            entry.intentPhrases.map((phrase) => ({
                actionType: entry.actionType,
                index: getIntentPhraseIndex(maskedText, phrase),
                phrase,
            }))
        )
        .filter((match) => match.index >= 0 && !isNegatedIntent(maskedText, match.phrase))
        .sort((left, right) => {
            const genericDifference =
                Number(isGenericDeviceIntent(left.phrase)) - Number(isGenericDeviceIntent(right.phrase));
            if (genericDifference !== 0) {
                return genericDifference;
            }
            if (left.index !== right.index) {
                return left.index - right.index;
            }
            return normalizePromptText(right.phrase).length - normalizePromptText(left.phrase).length;
        });
    const first = matches[0];
    if (!first) {
        return null;
    }
    const second = matches[1];
    if (
        second &&
        second.index === first.index &&
        normalizePromptText(second.phrase).length === normalizePromptText(first.phrase).length &&
        second.actionType !== first.actionType
    ) {
        const normalizedPhrase = normalizePromptText(first.phrase);
        if (expectedActionType && (normalizedPhrase === 'delete' || normalizedPhrase === 'remove')) {
            const expectedMatch = matches.find(
                (match) =>
                    match.index === first.index &&
                    normalizePromptText(match.phrase).length === normalizedPhrase.length &&
                    match.actionType === expectedActionType
            );
            if (expectedMatch) {
                return expectedMatch;
            }
        }
        return null;
    }
    return first;
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const reservedVcaGroupReferenceWords: ReadonlySet<string> = new Set(['group', 'vca', 'vca group']);

function getProjectReferenceTexts(context: ProjectContext): string[] {
    const vcaReferences = (context.vcaGroups ?? [])
        .flatMap((group) => [group.id, group.name])
        .filter((reference) => !reservedVcaGroupReferenceWords.has(normalizePromptText(reference)));
    const references = [
        ...vcaReferences,
        ...context.tracks.flatMap((track) => [
            track.id,
            track.name,
            ...track.devices.flatMap((device) => [
                device.id,
                device.type,
                ...(device.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.name]),
            ]),
            ...track.clips.flatMap((clip) => [clip.id, clip.name]),
        ]),
    ];
    return [...new Set(references)]
        .filter((reference) => reference.length > 0)
        .sort((left, right) => right.length - left.length);
}

const universalClearSolosIntentPhrases: ReadonlySet<string> = new Set([
    'clear all solos',
    'unsolo all tracks',
    'unsolo everything',
]);

const clearSolosRestrictionPatterns: readonly RegExp[] = [
    /\b(?:except|excluding|besides|minus)\b/u,
    /\b(?:other|rather)\s+than\b/u,
    /\bapart\s+from\b/u,
    /\bsave\s+for\b/u,
    /\bwith\s+(?:the\s+)?exception\s+of\b/u,
    /\b(?:all\s+but|but\s+not|not\s+including)\b/u,
    /\b(?:keep|leave|preserve|retain)\b/u,
];

type ClearSolosScope = 'restricted' | 'universal' | 'unsupported';

function hasReferenceOutsideMatchedIntent(text: string, intentPhrase: string, reference: string): boolean {
    const normalizedText = normalizePromptText(text);
    const normalizedIntent = normalizePromptText(intentPhrase);
    const normalizedReference = normalizePromptText(reference);
    if (normalizedReference.length === 0) {
        return false;
    }
    const intentStart = normalizedText.indexOf(normalizedIntent);
    if (intentStart < 0) {
        return true;
    }
    const intentEnd = intentStart + normalizedIntent.length;
    const referencePattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(normalizedReference)}(?![\\p{L}\\p{N}])`,
        'gu'
    );
    return [...normalizedText.matchAll(referencePattern)].some((match) => {
        const referenceStart = match.index;
        const referenceEnd = referenceStart + normalizedReference.length;
        return referenceStart < intentStart || referenceEnd > intentEnd;
    });
}

function classifyClearSolosScope(actionScope: ActionPromptScope, context: ProjectContext): ClearSolosScope {
    if (!universalClearSolosIntentPhrases.has(normalizePromptText(actionScope.matchedIntentPhrase))) {
        return 'unsupported';
    }
    const normalizedScope = normalizePromptText(actionScope.text);
    const hasRestriction = clearSolosRestrictionPatterns.some((pattern) => pattern.test(normalizedScope));
    const hasRelativeTrackReference =
        /\b(?:selected|current|this|that|these|those)\s+tracks?\b/u.test(normalizedScope) ||
        /\btrack\s+selection\b/u.test(normalizedScope);
    if (hasRestriction || hasRelativeTrackReference) {
        return 'restricted';
    }
    const trackReferences = context.tracks.flatMap((track) => [track.id, track.name]);
    const hasNamedTrackReference = trackReferences.some((reference) =>
        hasReferenceOutsideMatchedIntent(actionScope.text, actionScope.matchedIntentPhrase, reference)
    );
    return hasNamedTrackReference ? 'restricted' : 'universal';
}

const reservedClipReferenceWords: ReadonlySet<string> = new Set([
    'track',
    'clip',
    'device',
    'bus',
    'master',
    'output',
    'send',
    'parameter',
    'remove',
    'delete',
    'rename',
    'duplicate',
    'copy',
    'trim',
    'start',
    'end',
    'nudge',
    'gain',
    'volume',
]);

function getSemanticClipReferenceTexts(context: ProjectContext): string[] {
    const clipReferences = context.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.id, clip.name]));
    return [...new Set(clipReferences)]
        .filter((reference) => reference.length >= 'clip'.length)
        .filter((reference) => !reservedClipReferenceWords.has(normalizePromptText(reference)))
        .sort((left, right) => right.length - left.length);
}

function maskProjectReferences(prompt: string, context: ProjectContext): string {
    let maskedPrompt = prompt;
    for (const reference of getSemanticClipReferenceTexts(context)) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu');
        maskedPrompt = maskedPrompt.replaceAll(pattern, (match, offset: number) => {
            const explicitEntitySuffix = /^\s+(?:clip|track|device|bus|master|output|send|parameter)\b/iu.test(
                maskedPrompt.slice(offset + match.length)
            );
            if (explicitEntitySuffix) {
                return '□'.repeat(match.length);
            }
            return `clip${'□'.repeat(match.length - 'clip'.length)}`;
        });
    }
    for (const reference of getProjectReferenceTexts(context)) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu');
        maskedPrompt = maskedPrompt.replaceAll(pattern, (match) => '□'.repeat(match.length));
    }
    return maskedPrompt;
}

function isClipFadeValueSeparator({
    maskedPrompt,
    separatorEnd,
    separatorStart,
    start,
}: {
    maskedPrompt: string;
    separatorEnd: number;
    separatorStart: number;
    start: number;
}): boolean {
    const prefix = normalizePromptText(maskedPrompt.slice(start, separatorStart));
    if (!/\bset clip fades?\b/u.test(prefix)) {
        return false;
    }
    const suffix = normalizePromptText(maskedPrompt.slice(separatorEnd));
    return /^(?:fade in|fade out)(?: to| at)? -?\d/u.test(suffix);
}

function isBeatDurationValueSeparator({
    maskedPrompt,
    separatorEnd,
    separatorStart,
    start,
}: {
    maskedPrompt: string;
    separatorEnd: number;
    separatorStart: number;
    start: number;
}): boolean {
    const prefix = normalizePromptText(maskedPrompt.slice(start, separatorStart));
    const suffix = maskedPrompt.slice(separatorEnd).trim();
    return (
        /\bfit\b.*\bclip\b.*\bbeats?\b/u.test(prefix) &&
        /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?\s+beats?\b/u.test(suffix)
    );
}

function hasInvalidNamedClipFadeField(prompt: string): boolean {
    for (const clause of getPromptClauses(prompt, prompt)) {
        const normalizedClause = normalizePromptText(clause.text);
        for (const field of normalizedClause.matchAll(/\bfade (?:in|out)\b/gu)) {
            const suffix = normalizedClause.slice(field.index + field[0].length);
            if (!/^(?: to| at)? -?\d/u.test(suffix) || isNegatedIntent(clause.text, field[0])) {
                return true;
            }
        }
    }
    return false;
}

function getPromptClauses(prompt: string, maskedPrompt: string): PromptClause[] {
    const clauses: PromptClause[] = [];
    const separatorPattern = /\s+(?:and then|then|and|but)\s+|[;,\n]+|\.(?!\d)/giu;
    let start = 0;
    for (const match of maskedPrompt.matchAll(separatorPattern)) {
        const separatorEnd = match.index + match[0].length;
        const normalizedPrefix = normalizePromptText(maskedPrompt.slice(start, match.index));
        const normalizedSuffix = normalizePromptText(maskedPrompt.slice(separatorEnd));
        const normalizedSeparator = normalizePromptText(match[0]);
        const isValidatedListSeparator = normalizedSeparator === 'and' || match[0].trim() === ',';
        const isVcaMemberListSeparator =
            isValidatedListSeparator &&
            /^(?:create|add) vca group\b/u.test(normalizedPrefix) &&
            /\bfor\b/u.test(normalizedPrefix) &&
            !/\b(?:named|called)\b/u.test(normalizedPrefix) &&
            /\b(?:named|called)\b/u.test(normalizedSuffix);
        if (
            isVcaMemberListSeparator ||
            isClipFadeValueSeparator({
                maskedPrompt,
                separatorEnd,
                separatorStart: match.index,
                start,
            }) ||
            isBeatDurationValueSeparator({
                maskedPrompt,
                separatorEnd,
                separatorStart: match.index,
                start,
            })
        ) {
            continue;
        }
        if (prompt.slice(start, match.index).trim().length > 0) {
            clauses.push({ text: prompt.slice(start, match.index), masked: maskedPrompt.slice(start, match.index) });
        }
        start = separatorEnd;
    }
    if (prompt.slice(start).trim().length > 0) {
        clauses.push({ text: prompt.slice(start), masked: maskedPrompt.slice(start) });
    }
    return clauses;
}

function resolveDirectNamedBusCreationScope(
    prompt: string,
    assertedArguments: Readonly<Record<string, unknown>>,
    sameActionCallCount: number
): ActionPromptScope | null {
    if (sameActionCallCount !== 1 || typeof assertedArguments.name !== 'string') {
        return null;
    }
    const normalizedName = normalizePromptText(assertedArguments.name);
    if (!normalizedName.endsWith(' bus')) {
        return null;
    }
    const expectedPhrases = [
        `create ${normalizedName}`,
        `create a ${normalizedName}`,
        `create an ${normalizedName}`,
        `add ${normalizedName}`,
        `add a ${normalizedName}`,
        `add an ${normalizedName}`,
    ];
    const clause = getPromptClauses(prompt, prompt).find((candidate) => {
        const normalizedClause = ` ${normalizePromptText(candidate.text)} `;
        return expectedPhrases.some((phrase) => normalizedClause.includes(` ${phrase} `));
    });
    if (!clause) {
        return null;
    }
    return { ...clause, directional: false, matchedIntentPhrase: 'create bus' };
}

function resolveBulkTrackOutputScope(
    prompt: string,
    context: ProjectContext,
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[],
    sameActionCallCount: number
): ActionPromptScope | null {
    if (sameActionCallCount < 2 || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }
    const routeMatch = /\broute\b[\s\S]*?\b(?:into|to)\b[\s\S]*/iu.exec(prompt);
    if (!routeMatch) {
        return null;
    }
    const normalizedRoute = normalizePromptText(routeMatch[0]);
    const sourceMatch = /^route\s+(.+?)\s+(?:into|to)\b/u.exec(normalizedRoute);
    if (!sourceMatch) {
        return null;
    }
    const sourceList = sourceMatch[1];
    if (!sourceList) {
        return null;
    }
    const sourceScope = ` ${sourceList} `;
    const requestedSourceIds = context.tracks
        .filter((track) => sourceScope.includes(` ${normalizePromptText(track.name)} `))
        .map((track) => track.id);
    const assertedSourceIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.trackId === 'string' ? [arguments_.trackId] : []
    );
    const assertedOutputIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.outputId === 'string' ? [arguments_.outputId] : []
    );
    if (
        requestedSourceIds.length !== sameActionCallCount ||
        assertedSourceIds.length !== sameActionCallCount ||
        new Set(assertedSourceIds).size !== sameActionCallCount ||
        new Set(assertedOutputIds).size !== 1 ||
        !requestedSourceIds.every((trackId) => assertedSourceIds.includes(trackId))
    ) {
        return null;
    }
    return {
        text: routeMatch[0],
        masked: routeMatch[0],
        directional: false,
        matchedIntentPhrase: 'route',
    };
}

function resolveBulkDeviceInsertionScope(
    prompt: string,
    context: ProjectContext,
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[],
    sameActionCallCount: number
): ActionPromptScope | null {
    const expectedTrackIds = getBulkDeviceInsertionTrackScope(prompt, context)?.targetIds;
    if (!expectedTrackIds || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }
    const assertedTrackIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.trackId === 'string' ? [arguments_.trackId] : []
    );
    if (
        expectedTrackIds.length !== sameActionCallCount ||
        assertedTrackIds.length !== sameActionCallCount ||
        new Set(assertedTrackIds).size !== sameActionCallCount ||
        !expectedTrackIds.every((trackId) => assertedTrackIds.includes(trackId))
    ) {
        return null;
    }
    return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'insert device' };
}

function resolveBulkMutedEmptyTrackDeletionScope(
    prompt: string,
    context: ProjectContext,
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[],
    sameActionCallCount: number
): ActionPromptScope | null {
    const expectedTrackIds = getMutedEmptyTrackDeletionScope(prompt, context)?.targetIds;
    if (!expectedTrackIds || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }
    const assertedTrackIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.trackId === 'string' ? [arguments_.trackId] : []
    );
    if (
        expectedTrackIds.length !== sameActionCallCount ||
        assertedTrackIds.length !== sameActionCallCount ||
        new Set(assertedTrackIds).size !== sameActionCallCount ||
        !expectedTrackIds.every((trackId) => assertedTrackIds.includes(trackId))
    ) {
        return null;
    }
    return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'delete track' };
}

function resolveRepeatedTrackPanScope({
    actionOrdinal,
    prompt,
    context,
    sameActionAssertedArguments,
    sameActionCallCount,
}: Pick<
    ResolveActionPromptScopeInput,
    'actionOrdinal' | 'prompt' | 'context' | 'sameActionAssertedArguments' | 'sameActionCallCount'
>): ActionPromptScope | null {
    if (sameActionCallCount < 2 || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }

    const clauses = getPromptClauses(prompt, maskQuotedLabels(maskProjectReferences(prompt, context)));
    const scopedClauses: Array<{ clause: PromptClause; index: number }> = [];
    for (const assertedArguments of sameActionAssertedArguments) {
        if (typeof assertedArguments.trackId !== 'string' || typeof assertedArguments.pan !== 'number') {
            return null;
        }
        const track = context.tracks.find((candidate) => candidate.id === assertedArguments.trackId);
        if (!track) {
            return null;
        }
        const normalizedTrackName = normalizePromptText(track.name);
        const matches = clauses.flatMap((clause, index) => {
            const normalizedClause = ` ${normalizePromptText(clause.text)} `;
            return normalizedClause.includes(` ${normalizedTrackName} `) ? [{ clause, index }] : [];
        });
        if (matches.length !== 1 || !/-?(?:\d+(?:\.\d+)?|\.\d+)%?\s*(?:left|right)\b/iu.test(matches[0]!.clause.text)) {
            return null;
        }
        scopedClauses.push(matches[0]!);
    }

    const firstClause = scopedClauses[0];
    if (!firstClause || !/\b(?:pan|panning)\b/iu.test(firstClause.clause.text)) {
        return null;
    }
    if (scopedClauses.some((scope, index) => index > 0 && scope.index !== scopedClauses[index - 1]!.index + 1)) {
        return null;
    }

    const selectedScope = scopedClauses[actionOrdinal];
    if (!selectedScope) {
        return null;
    }
    return { ...selectedScope.clause, directional: false, matchedIntentPhrase: 'pan' };
}

function resolveDeviceParameterPromptScope({
    actionOrdinal,
    prompt,
    context,
    sameActionAssertedArguments,
    sameActionCallCount,
}: Pick<
    ResolveActionPromptScopeInput,
    'actionOrdinal' | 'prompt' | 'context' | 'sameActionAssertedArguments' | 'sameActionCallCount'
>): ActionPromptScope | null {
    const scope = getDeviceParameterPromptScope(prompt, context);
    if (!scope || scope.assignments.length !== sameActionCallCount) {
        return null;
    }
    const unmatchedAssignments = [...scope.assignments];
    const matchedAssignments = sameActionAssertedArguments.map((arguments_) => {
        const matchIndex = unmatchedAssignments.findIndex(
            ({ parameter, value }) =>
                arguments_.deviceId === scope.device.id &&
                arguments_.paramId === parameter.id &&
                arguments_.value === value
        );
        if (matchIndex < 0) {
            return null;
        }
        return unmatchedAssignments.splice(matchIndex, 1)[0] ?? null;
    });
    if (unmatchedAssignments.length > 0 || matchedAssignments.some((assignment) => assignment === null)) {
        return null;
    }
    const assignment = matchedAssignments[actionOrdinal];
    if (!assignment) {
        return null;
    }
    let displayedValue = `${String(assignment.value)} ${assignment.parameter.unit}`;
    if (assignment.parameter.unit === ':1') {
        displayedValue = `${String(assignment.value)}:1`;
    }
    const deviceName = scope.device.name ?? scope.device.type;
    const text = `Set ${deviceName} ${assignment.parameter.name} on ${scope.track.name} to ${displayedValue}`;
    return { text, masked: text, directional: false, matchedIntentPhrase: 'set' };
}

function resolveDirectionalIntentPhrase(
    maskedText: string,
    directionalIntent: NonNullable<GroundingRules['directionalIntent']>
): string | null {
    const normalizedText = normalizePromptText(maskedText);
    const paddedText = ` ${normalizedText} `;
    const polarityPhrases = [...directionalIntent.truePhrases, ...directionalIntent.falsePhrases];

    for (const carrierPhrase of directionalIntent.carrierPhrases) {
        const normalizedCarrier = normalizePromptText(carrierPhrase);
        const carrierNeedle = ` ${normalizedCarrier} `;
        const carrierIndex = paddedText.indexOf(carrierNeedle);
        if (carrierIndex < 0) {
            continue;
        }

        const afterCarrier = paddedText.slice(carrierIndex + carrierNeedle.length).trim();
        if (hasMaskedLocativeOwner(maskedText)) {
            const trailingTruePolarity = directionalIntent.truePhrases.find((truePhrase) => {
                const normalizedTruePhrase = normalizePromptText(truePhrase);
                return afterCarrier === normalizedTruePhrase || afterCarrier.endsWith(` ${normalizedTruePhrase}`);
            });
            if (trailingTruePolarity) {
                return `${normalizedCarrier} ${normalizePromptText(trailingTruePolarity)}`;
            }
        }
        for (const polarityPhrase of polarityPhrases) {
            const normalizedPolarity = normalizePromptText(polarityPhrase);
            if (afterCarrier === normalizedPolarity || afterCarrier.startsWith(`${normalizedPolarity} `)) {
                return `${normalizedCarrier} ${normalizedPolarity}`;
            }
        }
        for (const polarityPhrase of polarityPhrases) {
            const normalizedPolarity = normalizePromptText(polarityPhrase);
            if (afterCarrier === normalizedPolarity || afterCarrier.endsWith(` ${normalizedPolarity}`)) {
                if (normalizedPolarity === 'on' && hasMaskedLocativeOwner(maskedText)) {
                    const earlierTruePolarity = directionalIntent.truePhrases.find(
                        (truePhrase) => getIntentPhraseIndex(afterCarrier, truePhrase) >= 0
                    );
                    if (earlierTruePolarity) {
                        return `${normalizedCarrier} ${normalizePromptText(earlierTruePolarity)}`;
                    }
                }
                return `${normalizedCarrier} ${normalizedPolarity}`;
            }
        }
    }

    return null;
}

function hasMaskedLocativeOwner(maskedText: string): boolean {
    return (
        /\bon\s+(?:(?:the|my|our|this|that)\s+)?["'“”‘’]?□/iu.test(maskedText) ||
        /\bon\s+(?:the\s+)?(?:selected|current)\s+(?:track|device)\b/iu.test(maskedText)
    );
}

function isExplicitDirectionalCommandClause(
    text: string,
    directionalIntent: NonNullable<GroundingRules['directionalIntent']>,
    targetReferences: DirectionalTargetReferences
): boolean {
    let commandSource = text.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    if (/^["'“”‘’]/u.test(commandSource)) {
        return false;
    }
    const commandText = normalizePromptText(commandSource);
    if (hasUnsafeControlCue(commandSource, directionalIntent.carrierPhrases, targetReferences)) {
        return false;
    }
    if (/\b(?:without|not)\b.*\b(?:off|on)\b/u.test(commandText)) {
        return false;
    }

    return directionalIntent.carrierPhrases.some((carrierPhrase) => {
        const normalizedCarrier = normalizePromptText(carrierPhrase);
        return commandText === normalizedCarrier || commandText.startsWith(`${normalizedCarrier} `);
    });
}

type ReferenceRange = {
    end: number;
    start: number;
};

function getReferenceRanges(commandSource: string, reference: string): ReferenceRange[] {
    const referenceTokens = normalizePromptText(reference).split(' ').filter(Boolean);
    if (referenceTokens.length === 0) {
        return [];
    }
    const normalizedReferencePattern = referenceTokens.map(escapeRegExp).join('[^\\p{L}\\p{N}]+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${normalizedReferencePattern}(?![\\p{L}\\p{N}])`, 'giu');
    return [...commandSource.matchAll(pattern)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}

function getControlCarrierEnd(commandSource: string, carrierPhrases: readonly string[]): number | null {
    let carrierEnd: number | null = null;
    for (const carrierPhrase of carrierPhrases) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(carrierPhrase)}(?![\\p{L}\\p{N}])`, 'iu');
        const match = pattern.exec(commandSource);
        if (match && (carrierEnd === null || match.index < carrierEnd)) {
            carrierEnd = match.index + match[0].length;
        }
    }
    return carrierEnd;
}

function isCueWithinDirectionalTargetReference(
    commandSource: string,
    cueIndex: number,
    carrierEnd: number,
    targetReferences: DirectionalTargetReferences
): boolean {
    for (const reference of targetReferences.direct) {
        const containsCue = getReferenceRanges(commandSource, reference).some(
            (range) => range.start >= carrierEnd && cueIndex >= range.start && cueIndex < range.end
        );
        if (containsCue) {
            return true;
        }
    }
    for (const reference of targetReferences.owners) {
        const containsCue = getReferenceRanges(commandSource, reference).some((range) => {
            if (range.start < carrierEnd || cueIndex < range.start || cueIndex >= range.end) {
                return false;
            }
            const hasOwnerPrefix = /\bon\s+(?:(?:the|my|our|this|that)\s+)?["'“‘]?\s*$/iu.test(
                commandSource.slice(carrierEnd, range.start)
            );
            const normalizedOwnerSuffix = normalizePromptText(commandSource.slice(range.end));
            const hasOwnerSuffix = /^(?:(?:track|device)(?: (?:off|on))?|(?:off|on))?$/u.test(normalizedOwnerSuffix);
            return hasOwnerPrefix && hasOwnerSuffix;
        });
        if (containsCue) {
            return true;
        }
    }
    return false;
}

function hasUnsafeControlCue(
    commandSource: string,
    carrierPhrases: readonly string[],
    targetReferences: DirectionalTargetReferences
): boolean {
    const carrierEnd = getControlCarrierEnd(commandSource, carrierPhrases);
    for (const match of commandSource.matchAll(
        /\b(?:do\s+not|don(?:['’]t|t)|don\s+t|if|unless|maybe|never|not|perhaps)\b/giu
    )) {
        if (
            carrierEnd === null ||
            !isCueWithinDirectionalTargetReference(commandSource, match.index, carrierEnd, targetReferences)
        ) {
            return true;
        }
    }
    for (const match of commandSource.matchAll(/\bwithout\b/giu)) {
        if (
            carrierEnd !== null &&
            isCueWithinDirectionalTargetReference(commandSource, match.index, carrierEnd, targetReferences)
        ) {
            continue;
        }
        const followingWords = normalizePromptText(commandSource.slice(match.index + match[0].length))
            .split(' ')
            .slice(0, 4);
        const repeatsCarrierVerb = carrierPhrases.some((carrierPhrase) => {
            const carrierVerb = normalizePromptText(carrierPhrase).split(' ')[0];
            if (!carrierVerb) {
                return false;
            }
            const carrierStem = carrierVerb.endsWith('e') ? carrierVerb.slice(0, -1) : carrierVerb;
            return followingWords.some((word) => word.startsWith(carrierVerb) || word.startsWith(carrierStem));
        });
        if (repeatsCarrierVerb) {
            return true;
        }
    }
    return false;
}

function hasGroundedControlValueEvidence(
    valueRule: GroundingRules['valueRules'][number],
    assertedValue: string,
    promptText: string
): boolean {
    const referenceRanges = getReferenceRanges(promptText, assertedValue);
    if (referenceRanges.length === 0) {
        return false;
    }
    if (valueRule.kind === 'string-literal' || valueRule.kind === 'enum-if-present') {
        return true;
    }
    if (valueRule.kind === 'text-after-keyword-if-present') {
        return referenceRanges.some((range) => {
            const prefix = normalizePromptText(promptText.slice(0, range.start));
            return valueRule.keywords.some((keyword) => prefix.endsWith(normalizePromptText(keyword)));
        });
    }
    if (valueRule.kind === 'marker-name') {
        const markerName = getMarkerNameFromPrompt(promptText);
        return markerName !== null && normalizePromptText(assertedValue) === normalizePromptText(markerName);
    }
    if (valueRule.kind === 'marker-reference') {
        const markerName = getMarkerReferenceNameFromPrompt(promptText);
        return markerName !== null && normalizePromptText(assertedValue) === normalizePromptText(markerName);
    }
    if (valueRule.kind === 'marker-color') {
        const markerColor = getMarkerColorFromPrompt(promptText, valueRule.values);
        return markerColor !== null && normalizePromptText(assertedValue) === markerColor;
    }
    if (valueRule.kind === 'section-name' || valueRule.kind === 'section-reference') {
        const sectionName = getSectionNameFromPrompt(promptText);
        return sectionName !== null && normalizePromptText(assertedValue) === normalizePromptText(sectionName);
    }
    if (valueRule.kind === 'section-new-name') {
        const sectionName = getSectionNewNameFromPrompt(promptText);
        return sectionName !== null && normalizePromptText(assertedValue) === normalizePromptText(sectionName);
    }
    if (valueRule.kind === 'text-after-connector') {
        return referenceRanges.some((range) => {
            const prefix = normalizePromptText(promptText.slice(0, range.start));
            return prefix.endsWith(normalizePromptText(valueRule.connector));
        });
    }
    return false;
}

function getAssertedControlTargetReferences(
    groundingRules: GroundingRules,
    assertedArgumentSets: readonly Readonly<Record<string, unknown>>[],
    context: ProjectContext,
    promptText: string
): DirectionalTargetReferences {
    const direct = new Set<string>();
    const owners = new Set<string>();
    for (const assertedArguments of assertedArgumentSets) {
        for (const targetRule of groundingRules.targetRules) {
            const value = assertedArguments[targetRule.argument];
            if (typeof value === 'string') {
                direct.add(value);
                continue;
            }
            if (targetRule.capability === 'editable-clip' && Array.isArray(value)) {
                for (const item of value) {
                    if (typeof item === 'string') {
                        direct.add(item);
                    }
                }
            }
        }
        for (const valueRule of groundingRules.valueRules) {
            const value = assertedArguments[valueRule.argument];
            if (typeof value === 'string' && hasGroundedControlValueEvidence(valueRule, value, promptText)) {
                direct.add(value);
            }
        }
    }
    for (const targetRule of groundingRules.targetRules) {
        for (const assertedArguments of assertedArgumentSets) {
            const assertedValue = assertedArguments[targetRule.argument];
            let assertedIds: readonly unknown[] = [assertedValue];
            if (targetRule.capability === 'editable-clip' && Array.isArray(assertedValue)) {
                assertedIds = assertedValue;
            }
            for (const assertedId of assertedIds) {
                if (typeof assertedId !== 'string') {
                    continue;
                }
                for (const track of context.tracks) {
                    if (track.id === assertedId) {
                        direct.add(track.id);
                        direct.add(track.name);
                    }
                    const device = track.devices.find((candidate) => candidate.id === assertedId);
                    if (device) {
                        direct.add(device.id);
                        direct.add(device.type);
                        owners.add(track.id);
                        owners.add(track.name);
                    }
                    const clip = track.clips.find((candidate) => candidate.id === assertedId);
                    if (clip) {
                        direct.add(clip.id);
                        direct.add(clip.name);
                        owners.add(track.id);
                        owners.add(track.name);
                    }
                    for (const owningDevice of track.devices) {
                        const parameter = owningDevice.parameters?.find((candidate) => candidate.id === assertedId);
                        if (!parameter) {
                            continue;
                        }
                        direct.add(parameter.id);
                        direct.add(parameter.name);
                        owners.add(track.id);
                        owners.add(track.name);
                    }
                }
                const automationLane = context.automationLanes?.find((candidate) => candidate.id === assertedId);
                if (automationLane) {
                    direct.add(automationLane.id);
                    direct.add(automationLane.name);
                    const owner = context.tracks.find((track) => track.id === automationLane.trackId);
                    if (owner) {
                        owners.add(owner.id);
                        owners.add(owner.name);
                    }
                }
            }
        }
    }
    return { direct: [...direct], owners: [...owners] };
}

function resolveActionPromptScope({
    actionName,
    actionOrdinal,
    assertedArguments,
    catalog,
    compilerExpandedTargets = false,
    context,
    prompt,
    plannedActionNames,
    sameActionAssertedArguments,
    sameActionCallCount,
    workflowCapabilityId,
}: ResolveActionPromptScopeInput): ActionPromptScope | null {
    const groundingRules = getExecutableAppActionGroundingRules(actionName);
    const cancellationPrompt = actionName === 'glueClips' ? maskGlueQuotedLabels(prompt) : prompt;
    let hasActionCancellation = hasTrailingIntentCancellation(
        cancellationPrompt,
        actionName,
        catalog,
        plannedActionNames
    );
    if (
        isPunchActionType(actionName) ||
        hasPunchFamilyReference(prompt) ||
        actionName === 'setClipLoopLength' ||
        hasClipLoopLengthFamilyReference(prompt)
    ) {
        const promptActionAnalysis = analyzePromptActionRequests(prompt, catalog);
        const hasCancelledPunchRequest = promptActionAnalysis.requests.some(
            (request) => isPunchActionType(request.actionType) && request.cancelled
        );
        if (isPunchActionType(actionName) || hasCancelledPunchRequest) {
            hasActionCancellation = promptActionAnalysis.requests.some(
                (request) => request.actionType === actionName && request.cancelled
            );
        }
        const hasCancelledClipLoopLengthRequest = promptActionAnalysis.requests.some(
            (request) => request.actionType === 'setClipLoopLength' && request.cancelled
        );
        if (actionName === 'setClipLoopLength' || hasCancelledClipLoopLengthRequest) {
            hasActionCancellation = promptActionAnalysis.requests.some(
                (request) => request.actionType === actionName && request.cancelled
            );
        }
    }
    if (!groundingRules) {
        return null;
    }
    if (actionName === 'setTrackOutput' && workflowCapabilityId === 'drum-routing') {
        const drumRoutingScope = getDrumRoutingPromptScope(context);
        if (
            drumRoutingScope.status === 'request' &&
            sameActionCallCount === drumRoutingScope.targetIds.length &&
            sameActionAssertedArguments.every(
                (arguments_) =>
                    typeof arguments_.trackId === 'string' &&
                    drumRoutingScope.targetIds.includes(arguments_.trackId) &&
                    arguments_.outputId === drumRoutingScope.busId
            )
        ) {
            return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'route' };
        }
    }
    if (actionName === 'copyMidiArticulations' && workflowCapabilityId === 'articulation-transfer') {
        const articulationScope = getArticulationTransferPromptScope(context);
        if (
            articulationScope.status === 'request' &&
            sameActionCallCount === articulationScope.clipPairs.length &&
            sameActionAssertedArguments.every((arguments_) =>
                articulationScope.clipPairs.some(
                    (pair) =>
                        pair.sourceClipId === arguments_.sourceClipId && pair.targetClipId === arguments_.targetClipId
                )
            )
        ) {
            return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'copy articulation' };
        }
    }
    if (actionName === 'addSidechainRoute') {
        const sidechainRoutingScope = getSidechainRoutingPromptScope(prompt, context);
        if (
            sidechainRoutingScope.status === 'request' &&
            sameActionCallCount === sidechainRoutingScope.routes.length &&
            sameActionAssertedArguments.every((arguments_) =>
                sidechainRoutingScope.routes.some(
                    (route) =>
                        route.sourceTrackId === arguments_.sourceTrackId &&
                        route.targetTrackId === arguments_.targetTrackId &&
                        route.targetDeviceId === arguments_.targetDeviceId
                )
            )
        ) {
            return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'create sidechain' };
        }
    }
    if (hasActionCancellation) {
        return null;
    }
    if (actionName === 'setDeviceParameter') {
        const deviceParameterScope = resolveDeviceParameterPromptScope({
            actionOrdinal,
            prompt,
            context,
            sameActionAssertedArguments,
            sameActionCallCount,
        });
        if (deviceParameterScope) {
            return deviceParameterScope;
        }
    }
    if (actionName === 'setClipFade' && hasInvalidNamedClipFadeField(prompt)) {
        return null;
    }
    if (actionName === 'createBus') {
        const directBusCreationScope = resolveDirectNamedBusCreationScope(
            prompt,
            assertedArguments,
            sameActionCallCount
        );
        if (directBusCreationScope) {
            return directBusCreationScope;
        }
    }
    if (actionName === 'setTrackOutput') {
        const bulkTrackOutputScope = resolveBulkTrackOutputScope(
            prompt,
            context,
            sameActionAssertedArguments,
            sameActionCallCount
        );
        if (bulkTrackOutputScope) {
            return bulkTrackOutputScope;
        }
    }
    if (actionName === 'addDevice') {
        const bulkDeviceInsertionScope = resolveBulkDeviceInsertionScope(
            prompt,
            context,
            sameActionAssertedArguments,
            sameActionCallCount
        );
        if (bulkDeviceInsertionScope) {
            return bulkDeviceInsertionScope;
        }
    }
    if (actionName === 'removeTrack') {
        const bulkMutedEmptyTrackDeletionScope = resolveBulkMutedEmptyTrackDeletionScope(
            prompt,
            context,
            sameActionAssertedArguments,
            sameActionCallCount
        );
        if (bulkMutedEmptyTrackDeletionScope) {
            return bulkMutedEmptyTrackDeletionScope;
        }
    }
    if (actionName === 'setTrackPan') {
        const repeatedTrackPanScope = resolveRepeatedTrackPanScope({
            actionOrdinal,
            prompt,
            context,
            sameActionAssertedArguments,
            sameActionCallCount,
        });
        if (repeatedTrackPanScope) {
            return repeatedTrackPanScope;
        }
    }
    let projectMaskedPrompt = groundingRules.targetRules.length === 0 ? prompt : maskProjectReferences(prompt, context);
    if (actionName === 'glueClips') {
        projectMaskedPrompt = restoreGlueCommandIntents(prompt, projectMaskedPrompt);
    }
    let maskedPrompt = maskQuotedLabels(projectMaskedPrompt);
    if (actionName === 'glueClips') {
        maskedPrompt = maskGlueClipPairConjunction(maskedPrompt);
    }
    const matchingScopes: ActionPromptScope[] = [];
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const controlTargetReferences = getAssertedControlTargetReferences(
            groundingRules,
            sameActionAssertedArguments,
            context,
            clause.text
        );
        const intent = resolveClauseActionIntent(clause.masked, catalog, actionName);
        if (intent) {
            if (intent.actionType === actionName) {
                if (hasUnsafeControlCue(clause.text, groundingRules.intentPhrases, controlTargetReferences)) {
                    continue;
                }
                matchingScopes.push({ ...clause, directional: false, matchedIntentPhrase: intent.phrase });
            }
            continue;
        }
        const directionalIntentPhrase =
            groundingRules.directionalIntent &&
            isExplicitDirectionalCommandClause(clause.text, groundingRules.directionalIntent, controlTargetReferences)
                ? resolveDirectionalIntentPhrase(clause.masked, groundingRules.directionalIntent)
                : null;
        if (directionalIntentPhrase) {
            matchingScopes.push({ ...clause, directional: true, matchedIntentPhrase: directionalIntentPhrase });
        }
    }
    const appliesOneExplicitScopeToCompilerExpansion = compilerExpandedTargets && matchingScopes.length === 1;
    if (!appliesOneExplicitScopeToCompilerExpansion && matchingScopes.length !== sameActionCallCount) {
        return null;
    }
    const selectedScope = matchingScopes[appliesOneExplicitScopeToCompilerExpansion ? 0 : actionOrdinal];
    if (!selectedScope) {
        return null;
    }
    const selectedTargetReferences = getAssertedControlTargetReferences(
        groundingRules,
        [assertedArguments],
        context,
        selectedScope.text
    );
    if (selectedScope.directional && groundingRules.directionalIntent) {
        if (
            !isExplicitDirectionalCommandClause(
                selectedScope.text,
                groundingRules.directionalIntent,
                selectedTargetReferences
            )
        ) {
            return null;
        }
    } else if (hasUnsafeControlCue(selectedScope.text, groundingRules.intentPhrases, selectedTargetReferences)) {
        return null;
    }
    return selectedScope;
}

function getTargetPromptScope(
    actionScope: ActionPromptScope,
    promptRole?: 'source' | 'destination' | 'container' | 'members'
): string {
    if (!promptRole) {
        return actionScope.text;
    }
    if (promptRole === 'members') {
        const memberConnector = /\bfor\b/iu.exec(actionScope.masked);
        if (!memberConnector) {
            return '';
        }
        const memberStart = memberConnector.index + memberConnector[0].length;
        const nameConnector = /\b(?:named|called)\b/iu.exec(actionScope.masked.slice(memberStart));
        const memberEnd = nameConnector ? memberStart + nameConnector.index : actionScope.text.length;
        const memberScope = actionScope.text.slice(memberStart, memberEnd).trim();
        if (
            /\b(?:not|except|excluding|without|but|then|mute|solo|remove|delete|rename|route|send|set|assign|unassign|create|add)\b/iu.test(
                memberScope
            )
        ) {
            return '';
        }
        return memberScope;
    }
    if (promptRole === 'container') {
        return getAddClipPromptEvidence(actionScope)?.targetText ?? '';
    }
    const separator = /\b(?:to|into|through)\b/iu.exec(actionScope.masked);
    if (!separator) {
        return '';
    }
    if (promptRole === 'source') {
        return actionScope.text.slice(0, separator.index).trim();
    }
    return `to ${actionScope.text.slice(separator.index + separator[0].length).trim()}`;
}

type AddClipPromptEvidence = {
    endBeat: number;
    name: string;
    startBeat: number;
    targetText: string;
};

const addClipRangePattern =
    /\bfrom\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+to\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?![\p{L}\p{N}_.%])/giu;

function maskQuotedLabels(text: string): string {
    return text.replaceAll(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu, (label) => {
        const innerLabel = label.slice(1, -1).trim();
        const containsOnlyMaskedProjectReferences = /^(?:□+|clip□*)(?:\s+(?:□+|clip□*))*$/u.test(innerLabel);
        if (innerLabel.length === 0 || containsOnlyMaskedProjectReferences) {
            return label;
        }
        const closingQuote = label.at(-1)!;
        return `${label[0]!}${' '.repeat(label.length - 2)}${closingQuote}`;
    });
}

function maskGlueQuotedLabels(text: string): string {
    const quotePattern = /"[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;
    return text.replaceAll(quotePattern, (label) => {
        const innerLabel = label.slice(1, -1).trim();
        const containsOnlyMaskedProjectReferences = /^(?:□+|clip□*)(?:\s+(?:□+|clip□*))*$/u.test(innerLabel);
        if (innerLabel.length === 0 || containsOnlyMaskedProjectReferences) {
            return label;
        }
        return `${label[0]!}${' '.repeat(label.length - 2)}${label.at(-1)!}`;
    });
}

function maskGlueClipPairConjunction(text: string): string {
    const maskedReference = String.raw`(?:clip\s+)?(?:clip□*|□+)`;
    const pattern = new RegExp(
        `["'“‘]?${maskedReference}["'”’]?(?:\\s+clips?)?\\s+and\\s+(?=["'“‘]?${maskedReference})`,
        'giu'
    );
    return text.replaceAll(pattern, (pairPrefix) => pairPrefix.replace(/\band\b/iu, '   '));
}

function stripPoliteGlueCommandCarrier(text: string): string {
    let commandSource = text.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would|will)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    return commandSource.replace(/\s+(?:please|thanks|thank you)[.!?]*\s*$/iu, '');
}

function restoreGlueCommandIntents(prompt: string, maskedPrompt: string): string {
    const searchablePrompt = maskGlueQuotedLabels(prompt);
    const intentPattern =
        /(?:^|[;,\n.]|\b(?:then|and then|but)\b)\s*(?:(?:please\s+)?(?:can|could|would|will)\s+you(?:\s+please)?\s+|please\s+|(?:actually\s+)?(?:do\s+not|don['’]?t|don\s+t|dont|never)\s+)?(glue|join)\b/giu;
    let restoredPrompt = maskedPrompt;
    for (const match of searchablePrompt.matchAll(intentPattern)) {
        const intent = match[1];
        if (!intent) {
            continue;
        }
        const relativeIntentStart = match[0].toLocaleLowerCase().lastIndexOf(intent.toLocaleLowerCase());
        const intentStart = match.index + relativeIntentStart;
        restoredPrompt = `${restoredPrompt.slice(0, intentStart)}${prompt.slice(intentStart, intentStart + intent.length)}${restoredPrompt.slice(intentStart + intent.length)}`;
    }
    return restoredPrompt;
}

function getGlueClipPairTargetPattern(assertedClipIds: unknown, context: ProjectContext): string | null {
    if (
        !Array.isArray(assertedClipIds) ||
        assertedClipIds.length !== 2 ||
        !assertedClipIds.every((clipId): clipId is string => typeof clipId === 'string')
    ) {
        return null;
    }
    const clips = assertedClipIds.map((clipId) =>
        context.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
    );
    if (clips.some((clip) => !clip)) {
        return null;
    }
    function getReferencePattern(clip: NonNullable<(typeof clips)[number]>): string {
        const references = [clip.id, clip.name]
            .map(normalizePromptText)
            .filter((reference) => reference.length > 0)
            .toSorted((left, right) => right.length - left.length)
            .map(escapeRegExp);
        return `(?:${references.join('|')})`;
    }
    function orderedPair(left: string, right: string): string {
        const leftTarget = `(?:the )?(?:clip )?${left}(?: clips?)?`;
        const rightTarget = `(?:the )?(?:clip )?${right}(?: clips?)?`;
        return `${leftTarget} (?:and|with) ${rightTarget}`;
    }
    const first = getReferencePattern(clips[0]!);
    const second = getReferencePattern(clips[1]!);
    return `(?:${orderedPair(first, second)}|${orderedPair(second, first)})`;
}

function isDirectGlueClipPairScope(
    actionScope: ActionPromptScope,
    assertedClipIds: unknown,
    context: ProjectContext
): boolean {
    if (
        !Array.isArray(assertedClipIds) ||
        assertedClipIds.length !== 2 ||
        !assertedClipIds.every((clipId): clipId is string => typeof clipId === 'string')
    ) {
        return false;
    }
    const normalizedScope = normalizePromptText(stripPoliteGlueCommandCarrier(actionScope.text));
    if (/^(?:glue|join)(?: the)? selected clips$/u.test(normalizedScope)) {
        const selectedIds = new Set(context.selectedClipIds);
        return selectedIds.size === 2 && assertedClipIds.every((clipId) => selectedIds.has(clipId));
    }
    const targetPattern = getGlueClipPairTargetPattern(assertedClipIds, context);
    if (!targetPattern) {
        return false;
    }
    return new RegExp(`^(?:glue|join) ${targetPattern}$`, 'u').test(normalizedScope);
}

type GluePromptAnalysis =
    { status: 'none' } | { status: 'invalid' } | { status: 'request'; cancelled: boolean; clipIds: [string, string] };

const invalidGlueRequestReason =
    'Glue request must contain exactly one unambiguous direct clip pair or selected-clips command';
const mismatchedGluePlanReason = 'Provider glue plan does not exactly match the single grounded glue request';

function getGluePromptClauses(prompt: string, context: ProjectContext): PromptClause[] {
    const projectMaskedPrompt = maskProjectReferences(prompt, context);
    const intentRestoredPrompt = restoreGlueCommandIntents(prompt, projectMaskedPrompt);
    const quoteMaskedPrompt = maskGlueQuotedLabels(intentRestoredPrompt);
    return getPromptClauses(prompt, maskGlueClipPairConjunction(quoteMaskedPrompt));
}

function getGlueClipPairs(context: ProjectContext): Array<[string, string]> {
    if (context.glueEligibleClipPairs) {
        return context.glueEligibleClipPairs.map(([firstClipId, secondClipId]) => [firstClipId, secondClipId]);
    }
    const clipIds = context.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
    const pairs: Array<[string, string]> = [];
    for (const [index, clipId] of clipIds.entries()) {
        for (const otherClipId of clipIds.slice(index + 1)) {
            pairs.push([clipId, otherClipId]);
        }
    }
    return pairs;
}

function isDeclarativeGlueClause(commandText: string): boolean {
    return (
        /^(?:glue|join) (?:is|are)\b/u.test(commandText) ||
        /^(?:glue|join)\b.*\b(?:is|are) (?:an? )?clips?$/u.test(commandText)
    );
}

function isPotentialGlueCommand(commandText: string, context: ProjectContext): boolean {
    if (!/^(?:glue|join)\b/u.test(commandText)) {
        return false;
    }
    const targetText = commandText.replace(/^(?:glue|join)\s+/u, '');
    if (/^(?:(?:the )?selected clips|(?:the )?clips?)(?: |$)/u.test(targetText)) {
        return true;
    }
    return context.tracks.some((track) =>
        track.clips.some((clip) =>
            [clip.id, clip.name].some((reference) => {
                const normalizedReference = normalizePromptText(reference);
                const directTargets = [
                    normalizedReference,
                    `the ${normalizedReference}`,
                    `clip ${normalizedReference}`,
                    `the clip ${normalizedReference}`,
                ];
                return directTargets.some(
                    (directTarget) => targetText === directTarget || targetText.startsWith(`${directTarget} `)
                );
            })
        )
    );
}

function isGlueCancellationClause(clause: PromptClause, clipIds: [string, string], context: ProjectContext): boolean {
    const visibleText = normalizePromptText(clause.masked);
    const normalizedText = normalizePromptText(clause.text);
    const visibleCancellation =
        /^(?:but )?(?:never mind\b|(?:actually )?(?:do not|don t|dont|never) (?:glue|join)\b|(?:cancel|abort|scratch)\b|keep\b|leave\b|actually (?:do not|don t|dont)\b|without\b)/u;
    if (!visibleCancellation.test(visibleText)) {
        return false;
    }
    const targetPattern = getGlueClipPairTargetPattern(clipIds, context);
    if (!targetPattern) {
        return false;
    }
    const cancellationPatterns = [
        new RegExp(
            `^(?:but )?(?:actually )?(?:do not|don t|dont|never) (?:glue|join) (?:them|the clips|the exact pair|${targetPattern})(?: |$)`,
            'u'
        ),
        /^(?:but )?(?:cancel|abort|scratch) (?:it|them|(?:that|this) (?:command|request)|the clips|the exact pair)(?: |$)/u,
        /^(?:but )?never mind(?: |$)/u,
        /^(?:but )?keep (?:them|the clips|the exact pair) separate(?: |$)/u,
        /^(?:but )?leave (?:(?:them|the clips|the exact pair) )?unchanged(?: |$)/u,
        /^(?:but )?actually (?:do not|don t|dont)(?: |$)/u,
        /^(?:but )?without (?:(?:making|applying) (?:any )?changes|changing (?:anything|it|them)|(?:any )?changes)(?: |$)/u,
    ];
    return cancellationPatterns.some((pattern) => pattern.test(normalizedText));
}

function analyzeGluePrompt(prompt: string, context: ProjectContext): GluePromptAnalysis {
    let pairs: Array<[string, string]> | null = null;
    const requests: Array<{ clauseIndex: number; clipIds: [string, string] }> = [];
    let hasInvalidRequest = false;
    const clauses = getGluePromptClauses(prompt, context);
    for (const [clauseIndex, clause] of clauses.entries()) {
        const commandText = normalizePromptText(stripPoliteGlueCommandCarrier(clause.text));
        const maskedCommandText = normalizePromptText(stripPoliteGlueCommandCarrier(clause.masked));
        if (!/^(?:glue|join)\b/u.test(maskedCommandText) || isDeclarativeGlueClause(maskedCommandText)) {
            continue;
        }
        pairs ??= getGlueClipPairs(context);
        const matches = pairs.filter((clipIds) =>
            isDirectGlueClipPairScope(
                { ...clause, directional: false, matchedIntentPhrase: commandText.split(' ')[0]! },
                clipIds,
                context
            )
        );
        if (matches.length === 1) {
            requests.push({ clauseIndex, clipIds: matches[0]! });
            continue;
        }
        if (isPotentialGlueCommand(commandText, context)) {
            hasInvalidRequest = true;
        }
    }
    if (hasInvalidRequest || requests.length > 1) {
        return { status: 'invalid' };
    }
    const request = requests[0];
    if (!request) {
        return { status: 'none' };
    }
    const cancelled = clauses
        .slice(request.clauseIndex + 1)
        .some((clause) => isGlueCancellationClause(clause, request.clipIds, context));
    return { status: 'request', cancelled, clipIds: request.clipIds };
}

function hasExactGlueClipPair(assertedClipIds: unknown, expectedClipIds: [string, string]): boolean {
    if (
        !Array.isArray(assertedClipIds) ||
        assertedClipIds.length !== 2 ||
        !assertedClipIds.every((clipId): clipId is string => typeof clipId === 'string')
    ) {
        return false;
    }
    const assertedIds = new Set(assertedClipIds);
    return assertedIds.size === 2 && expectedClipIds.every((clipId) => assertedIds.has(clipId));
}

function getAddClipPromptEvidence(actionScope: ActionPromptScope): AddClipPromptEvidence | null {
    const keywords = [...actionScope.masked.matchAll(/\b(?:named|called)\b/giu)];
    if (keywords.length !== 1) {
        return null;
    }
    const keyword = keywords[0]!;
    const ranges = [...actionScope.masked.matchAll(addClipRangePattern)];
    if (ranges.length !== 1 || [...actionScope.masked.matchAll(/\bbeat\b/giu)].length !== 2) {
        return null;
    }
    const range = ranges[0]!;
    const rangeIndex = range.index;
    const rawStartBeat = range[1]!;
    const rawEndBeat = range[2]!;
    const suffix = actionScope.text.slice(rangeIndex + range[0].length);
    if (!/^[\s,.;!?]*$/u.test(suffix)) {
        return null;
    }
    const beforeRange = actionScope.text.slice(keyword.index + keyword[0].length, rangeIndex);
    const maskedBeforeRange = actionScope.masked.slice(keyword.index + keyword[0].length, rangeIndex);
    const connectors = [...maskedBeforeRange.matchAll(/\b(?:on|to|into)\b/giu)];
    const connector = connectors.at(-1);
    if (!connector) {
        return null;
    }
    const nameText = beforeRange.slice(0, connector.index).trim();
    const targetText = beforeRange.slice(connector.index + connector[0].length).trim();
    if (!nameText || !targetText) {
        return null;
    }
    const quotedName = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)$/u.exec(nameText);
    let name = quotedName?.[1] ?? quotedName?.[2] ?? quotedName?.[3] ?? quotedName?.[4] ?? null;
    if (name === null) {
        if (/\b(?:on|to|into|from)\b/iu.test(nameText) || /["'“”‘’]/u.test(nameText)) {
            return null;
        }
        name = nameText;
    }
    const startBeat = Number(rawStartBeat);
    const endBeat = Number(rawEndBeat);
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat)) {
        return null;
    }
    return { endBeat, name: name.trim(), startBeat, targetText };
}

function isDirectAddClipTarget(targetText: string, trackId: unknown, context: ProjectContext): boolean {
    if (typeof trackId !== 'string') {
        return false;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return false;
    }
    const normalizedTarget = normalizePromptText(targetText);
    const normalizedName = normalizePromptText(track.name);
    const normalizedId = normalizePromptText(track.id);
    const allowed = new Set([
        normalizedName,
        normalizedId,
        `track ${normalizedName}`,
        `${normalizedName} track`,
        `the ${normalizedName} track`,
    ]);
    if (context.selectedTrackId === track.id) {
        allowed.add('selected track');
        allowed.add('the selected track');
        allowed.add('current track');
        allowed.add('the current track');
        allowed.add('this track');
    }
    return allowed.has(normalizedTarget);
}

const moveBeatAssertionPattern =
    /\bbeat\b[\s:=]*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?)(?![\p{L}\p{N}_.])/giu;

function getMoveBeatAssertions(text: string): RegExpExecArray[] {
    return [...text.matchAll(moveBeatAssertionPattern)];
}

function hasExactlyOneMoveBeatAssertion(actionScope: string): boolean {
    const assertions = getMoveBeatAssertions(actionScope);
    if (assertions.length !== 1) {
        return false;
    }
    return assertions.every((assertion) => {
        const rawValue = assertion[1];
        if (!rawValue || rawValue.endsWith('%')) {
            return false;
        }
        const suffix = actionScope.slice(assertion.index + assertion[0].length);
        return !/^\s*(?:bars?|beats?|seconds?|secs?|minutes?|mins?|%)/iu.test(suffix);
    });
}

function hasGroundedMoveBeatAssertions({
    catalog,
    context,
    expectedMoveCount,
    plannedActionNames,
    prompt,
}: {
    catalog: GroundingCatalog;
    context: ProjectContext;
    expectedMoveCount: number;
    plannedActionNames: readonly string[];
    prompt: string;
}): boolean {
    const maskedPrompt = maskProjectReferences(prompt, context);
    let moveClauseCount = 0;
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const assertions = getMoveBeatAssertions(clause.text);
        if (assertions.length === 0) {
            continue;
        }
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (intent?.actionType === 'moveClip') {
            if (!hasExactlyOneMoveBeatAssertion(clause.text)) {
                return false;
            }
            moveClauseCount += 1;
            continue;
        }
        if (!intent || !plannedActionNames.includes(intent.actionType)) {
            return false;
        }
    }
    return moveClauseCount === expectedMoveCount;
}

function hasGroundedSplitBeatAssertions({
    catalog,
    context,
    expectedSplitCount,
    plannedActionNames,
    prompt,
}: {
    catalog: GroundingCatalog;
    context: ProjectContext;
    expectedSplitCount: number;
    plannedActionNames: readonly string[];
    prompt: string;
}): boolean {
    const maskedPrompt = maskProjectReferences(prompt, context);
    let splitClauseCount = 0;
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const assertions = getMoveBeatAssertions(clause.text);
        const unmaskedNumbers = clause.masked.match(
            /(?<![\p{L}\p{N}_.])-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?(?![\p{L}\p{N}_.])/gu
        );
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (assertions.length === 0) {
            if ((unmaskedNumbers?.length ?? 0) > 0 && (!intent || intent.actionType === 'splitClip')) {
                return false;
            }
            continue;
        }
        if (intent?.actionType === 'splitClip') {
            if (!hasExactlyOneMoveBeatAssertion(clause.text)) {
                return false;
            }
            if (unmaskedNumbers?.length !== 1) {
                return false;
            }
            splitClauseCount += 1;
            continue;
        }
        if (!intent || !plannedActionNames.includes(intent.actionType)) {
            return false;
        }
    }
    return splitClauseCount === expectedSplitCount;
}

function hasGroundedAddClipAssertions({
    catalog,
    context,
    expectedAddClipCount,
    plannedActionNames,
    prompt,
}: {
    catalog: GroundingCatalog;
    context: ProjectContext;
    expectedAddClipCount: number;
    plannedActionNames: readonly string[];
    prompt: string;
}): boolean {
    const maskedPrompt = maskQuotedLabels(maskProjectReferences(prompt, context));
    let addClipClauseCount = 0;
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (intent?.actionType === 'addClip') {
            const actionScope: ActionPromptScope = {
                ...clause,
                directional: false,
                matchedIntentPhrase: intent.phrase,
            };
            if (!getAddClipPromptEvidence(actionScope)) {
                return false;
            }
            addClipClauseCount += 1;
            continue;
        }
        const unquotedClause = maskQuotedLabels(clause.masked);
        const hasNumericOrBeatAssertion = /\d|\b(?:beats?|bars?)\b/iu.test(unquotedClause);
        if (!hasNumericOrBeatAssertion) {
            continue;
        }
        if (!intent || !plannedActionNames.includes(intent.actionType)) {
            return false;
        }
    }
    return addClipClauseCount === expectedAddClipCount;
}

function isDirectMoveClipDestination(
    actionScope: ActionPromptScope,
    trackId: unknown,
    context: ProjectContext
): boolean {
    if (typeof trackId !== 'string') {
        return false;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return false;
    }
    if (/\b(?:through|(?:according|next)\s+to)\b/iu.test(actionScope.masked)) {
        return false;
    }
    const targetScope = normalizePromptText(getTargetPromptScope(actionScope, 'destination')).replace(/^to\s+/u, '');
    const references = [track.id, track.name]
        .map((reference) => normalizePromptText(reference))
        .filter((reference) => reference.length > 0)
        .sort((left, right) => right.length - left.length);
    return references.some((reference) =>
        [
            reference,
            `the ${reference}`,
            `track ${reference}`,
            `the track ${reference}`,
            `${reference} track`,
            `the ${reference} track`,
        ].some((prefix) => targetScope === prefix || targetScope.startsWith(`${prefix} `))
    );
}

function isDirectSplitClipScope(actionScope: ActionPromptScope, clipId: unknown, context: ProjectContext): boolean {
    if (typeof clipId !== 'string') {
        return false;
    }
    const clip = context.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!clip) {
        return false;
    }
    const normalizedScope = normalizePromptText(actionScope.text);
    const namedSubjects = [clip.id, clip.name]
        .map(normalizePromptText)
        .filter((reference) => reference.length > 0)
        .map((reference) => `(?:the\\s+)?${escapeRegExp(reference)}\\s+clip`);
    const directSubjects = ['(?:the\\s+)?(?:(?:selected|current)\\s+)?clip', 'this\\s+clip', ...namedSubjects].join(
        '|'
    );
    const hasDirectWholeClipSubject = new RegExp(
        `\\b(?:split|cut)\\s+(?:${directSubjects})\\s+(?:at\\s+)?beat\\b`,
        'u'
    ).test(normalizedScope);
    if (!hasDirectWholeClipSubject) {
        return false;
    }
    const assertions = getMoveBeatAssertions(actionScope.text);
    if (assertions.length !== 1) {
        return false;
    }
    const assertion = assertions[0]!;
    const suffix = actionScope.text.slice(assertion.index + assertion[0].length);
    return /^[\s.,!?]*$/u.test(suffix);
}

type GroundingValueRule = GroundingRules['valueRules'][number];

type PromptNumber = {
    end: number;
    index: number;
    raw: string;
};

function findConnectorBoundNumber(maskedScope: string, numbers: readonly PromptNumber[]): PromptNumber | null {
    let boundNumber: PromptNumber | null = null;
    for (const connector of maskedScope.matchAll(/\b(?:to|at|position|index|value|level|bpm|tempo)\b/giu)) {
        const connectorEnd = connector.index + connector[0].length;
        const number = numbers.find((candidate) => {
            if (candidate.index < connectorEnd) {
                return false;
            }
            return /^[\s:=]*$/u.test(maskedScope.slice(connectorEnd, candidate.index));
        });
        if (number) {
            boundNumber = number;
        }
    }
    return boundNumber;
}

function findNamedConnectorBoundNumber(
    maskedScope: string,
    numbers: readonly PromptNumber[],
    connectorName: 'from' | 'to' | 'beat'
): PromptNumber | null {
    const connectorPattern = new RegExp(`\\b${connectorName}\\b`, 'giu');
    for (const connector of maskedScope.matchAll(connectorPattern)) {
        const connectorEnd = connector.index + connector[0].length;
        const number = numbers.find((candidate) => {
            if (candidate.index < connectorEnd) {
                return false;
            }
            return /^[\s:=]*(?:beat\s*)?$/iu.test(maskedScope.slice(connectorEnd, candidate.index));
        });
        if (number) {
            return number;
        }
    }
    return null;
}

function findKeywordBoundNumber(
    maskedScope: string,
    numbers: readonly PromptNumber[],
    keywords: readonly string[]
): PromptNumber | null {
    for (const keyword of keywords) {
        const keywordPattern = escapeRegExp(keyword).replaceAll(' ', '\\s+');
        for (const match of maskedScope.matchAll(new RegExp(`\\b${keywordPattern}\\b`, 'giu'))) {
            const keywordEnd = match.index + match[0].length;
            const number = numbers.find((candidate) => {
                if (candidate.index < keywordEnd) {
                    return false;
                }
                return /^[\s:=]*(?:(?:to|at)\s*)?$/iu.test(maskedScope.slice(keywordEnd, candidate.index));
            });
            if (number) {
                return number;
            }
        }
    }
    return null;
}

function findStretchRatioNumbers(maskedScope: string, numbers: readonly PromptNumber[]): PromptNumber[] {
    function hasDurationUnit(number: PromptNumber): boolean {
        return /^\s*(?:beats?|bars?|seconds?|secs?|minutes?|mins?)\b/iu.test(maskedScope.slice(number.end));
    }
    const matches: PromptNumber[] = [];
    const keywordBoundNumber = findKeywordBoundNumber(maskedScope, numbers, ['ratio']);
    if (keywordBoundNumber && !hasDurationUnit(keywordBoundNumber)) {
        matches.push(keywordBoundNumber);
    }
    for (const number of numbers) {
        if (hasDurationUnit(number) || !/^\s*(?:x\b|×|times\b)/iu.test(maskedScope.slice(number.end))) {
            continue;
        }
        if (!matches.includes(number)) {
            matches.push(number);
        }
    }
    return matches;
}

function findBeatDurationNumbers(maskedScope: string, numbers: readonly PromptNumber[]): PromptNumber[] {
    return numbers.filter((number) => /^\s*beats?\b/iu.test(maskedScope.slice(number.end)));
}

function isBoundBeatDurationNumber(maskedScope: string, number: PromptNumber): boolean {
    const prefix = normalizePromptText(maskedScope.slice(0, number.index));
    return (
        /\bfit(?: the)? clip(?: duration)? to$/u.test(prefix) ||
        /\b(?:set|change)(?: the)? .+ clip loop length to$/u.test(prefix) ||
        /\b(?:set|change)(?: the)? clip loop length (?:of|for) .+ to$/u.test(prefix)
    );
}

function isExplicitClipLoopLengthPrompt(prompt: string): boolean {
    const beatValue = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?`;
    const directSubjectRequest = new RegExp(
        String.raw`^(?:please\s+)?(?:set|change)\s+(?:the\s+)?(?:selected|.+?)\s+clip\s+loop\s+length\s+to\s+${beatValue}\s+beats?\s*[.!]?$`,
        'iu'
    );
    const trailingSubjectRequest = new RegExp(
        String.raw`^(?:please\s+)?(?:set|change)\s+(?:the\s+)?clip\s+loop\s+length\s+(?:of|for)\s+(?:the\s+)?(?:selected\s+clip|.+?)\s+to\s+${beatValue}\s+beats?\s*[.!]?$`,
        'iu'
    );
    const trimmedPrompt = prompt.trim();
    return directSubjectRequest.test(trimmedPrompt) || trailingSubjectRequest.test(trimmedPrompt);
}

function findDirectionBoundNumber(maskedScope: string, numbers: readonly PromptNumber[]): PromptNumber | null {
    return numbers.find((number) => /^\s*(?:left|right)\b/iu.test(maskedScope.slice(number.end))) ?? null;
}

type AutomationLaneValueRange = NonNullable<ProjectContext['automationLanes']>[number];

function scalePromptNumber(
    value: number,
    isPercentage: boolean,
    valueRule: Extract<GroundingValueRule, { kind: 'number-if-present' }>,
    automationLane: AutomationLaneValueRange | undefined
): number {
    if (valueRule.scale === 'unit-interval' && (isPercentage || Math.abs(value) > 1)) {
        return value / 100;
    }
    if (valueRule.scale === 'percentage-only' && isPercentage) {
        return value / 100;
    }
    if (valueRule.scale !== 'automation-lane-range' || !isPercentage || !automationLane) {
        return value;
    }

    const normalizedPercentage = value / 100;
    if (automationLane.parameterId === 'pan' && automationLane.minValue === -1 && automationLane.maxValue === 1) {
        return normalizedPercentage;
    }
    return automationLane.minValue + normalizedPercentage * (automationLane.maxValue - automationLane.minValue);
}

function normalizePromptNumber(
    number: PromptNumber,
    actionScope: ActionPromptScope,
    valueRule: Extract<GroundingValueRule, { kind: 'number-if-present' }>,
    automationLane: AutomationLaneValueRange | undefined
): number {
    const isPercentage = number.raw.endsWith('%');
    const rawWithoutPercentage = isPercentage ? number.raw.slice(0, -1) : number.raw;
    const fractionParts = rawWithoutPercentage.split('/');
    let rawValue = Number.parseFloat(rawWithoutPercentage);
    if (fractionParts.length === 2) {
        const numerator = Number.parseFloat(fractionParts[0]!.trim());
        const denominator = Number.parseFloat(fractionParts[1]!.trim());
        rawValue = denominator === 0 ? Number.NaN : numerator / denominator;
    }
    const value = scalePromptNumber(rawValue, isPercentage, valueRule, automationLane);
    if (valueRule.direction !== 'pan') {
        return value;
    }
    const localDirection = /^\s*(left|right)\b/iu.exec(actionScope.masked.slice(number.end))?.[1];
    const normalizedScope = normalizePromptText(actionScope.masked);
    if (localDirection?.toLocaleLowerCase() === 'left' || (!localDirection && /\bleft\b/u.test(normalizedScope))) {
        return -Math.abs(value);
    }
    if (localDirection?.toLocaleLowerCase() === 'right' || (!localDirection && /\bright\b/u.test(normalizedScope))) {
        return Math.abs(value);
    }
    return value;
}

function getExpectedNumbers(
    actionScope: ActionPromptScope,
    valueRule: GroundingValueRule,
    automationLane: AutomationLaneValueRange | undefined
): number[] | null {
    if (valueRule.kind !== 'number-if-present') {
        return [];
    }
    const numbers = [
        ...actionScope.masked.matchAll(/-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?/gu),
    ].map((match) => ({
        end: match.index + match[0].length,
        index: match.index,
        raw: match[0],
    }));
    if (numbers.length === 0) {
        return [];
    }
    if (numbers.length > 1 && /\b(?:either|or)\b/iu.test(actionScope.masked)) {
        return null;
    }
    if (valueRule.unit === 'stretch-ratio') {
        const ratioNumbers = findStretchRatioNumbers(actionScope.masked, numbers);
        if (ratioNumbers.length !== 1) {
            return ratioNumbers.length === 0 ? [] : null;
        }
        return [normalizePromptNumber(ratioNumbers[0]!, actionScope, valueRule, automationLane)];
    }
    if (valueRule.unit === 'beat-duration') {
        const beatNumbers = findBeatDurationNumbers(actionScope.masked, numbers);
        if (beatNumbers.some((number) => number.raw.endsWith('%'))) {
            return null;
        }
        if (beatNumbers.length !== 1) {
            return beatNumbers.length === 0 ? [] : null;
        }
        if (!isBoundBeatDurationNumber(actionScope.masked, beatNumbers[0]!)) {
            return null;
        }
        return [normalizePromptNumber(beatNumbers[0]!, actionScope, valueRule, automationLane)];
    }
    if (valueRule.keywords) {
        const keywordBoundNumber = findKeywordBoundNumber(actionScope.masked, numbers, valueRule.keywords);
        if (keywordBoundNumber) {
            return [normalizePromptNumber(keywordBoundNumber, actionScope, valueRule, automationLane)];
        }
        if (!valueRule.connector) {
            return null;
        }
    }
    if (valueRule.connector) {
        const connectorBoundNumber = findNamedConnectorBoundNumber(actionScope.masked, numbers, valueRule.connector);
        if (!connectorBoundNumber) {
            return null;
        }
        return [normalizePromptNumber(connectorBoundNumber, actionScope, valueRule, automationLane)];
    }
    const boundNumber =
        findConnectorBoundNumber(actionScope.masked, numbers) ?? findDirectionBoundNumber(actionScope.masked, numbers);
    if (boundNumber) {
        return [normalizePromptNumber(boundNumber, actionScope, valueRule, automationLane)];
    }
    if (numbers.length > 1) {
        return null;
    }
    const onlyNumber = numbers[0];
    if (!onlyNumber) {
        return [];
    }
    return [normalizePromptNumber(onlyNumber, actionScope, valueRule, automationLane)];
}

function getTextAfterKeyword(
    actionScope: ActionPromptScope,
    keywords: readonly string[],
    terminators: readonly string[] = []
): string | null {
    const matches = keywords
        .map((keyword) => ({
            match: new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'iu').exec(actionScope.masked),
        }))
        .filter((candidate): candidate is { match: RegExpExecArray } => candidate.match !== null)
        .sort((left, right) => left.match.index - right.match.index);
    const match = matches[0]?.match;
    if (!match) {
        return null;
    }
    const valueStart = match.index + match[0].length;
    const remainingMasked = actionScope.masked.slice(valueStart);
    const terminatorMatches = terminators
        .map((terminator) => new RegExp(`\\b${escapeRegExp(terminator)}\\b`, 'iu').exec(remainingMasked))
        .filter((candidate): candidate is RegExpExecArray => candidate !== null)
        .sort((left, right) => left.index - right.index);
    const valueEnd = terminatorMatches[0] ? valueStart + terminatorMatches[0].index : actionScope.text.length;
    return actionScope.text.slice(valueStart, valueEnd).trim();
}

function getMarkerNameFromPrompt(promptText: string): string | null {
    const keyword = /\b(?:named|called)\b/iu.exec(promptText);
    if (!keyword) {
        return null;
    }

    const tail = promptText.slice(keyword.index + keyword[0].length).trim();
    const quoted = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)/u.exec(tail);
    const quotedName = quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? quoted?.[4] ?? null;
    if (quotedName !== null) {
        return quotedName.trim() || null;
    }

    const boundary =
        /\s+(?=(?:(?:at|on)\s+(?:beat|bar)\b|because\b|since\b|so\b|to\b|for\b|as\b|which\b|when\b|where\b))/iu.exec(
            tail
        );
    const unquotedName = tail
        .slice(0, boundary?.index ?? tail.length)
        .replace(/[,:;.?!]+$/u, '')
        .trim();
    return unquotedName || null;
}

function getMarkerReferenceNameFromPrompt(promptText: string): string | null {
    const intent =
        /\b(?:(?:remove|delete)(?:\s+the)?\s+marker|(?:set|change)(?:\s+the)?\s+marker\s+color(?:\s+(?:for|of))?|recolor(?:\s+the)?\s+marker)\b/iu.exec(
            promptText
        );
    if (!intent) {
        return null;
    }

    let tail = promptText.slice(intent.index + intent[0].length).trim();
    tail = tail.replace(/^(?:named|called)\b/iu, '').trim();
    const quoted = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)/u.exec(tail);
    const quotedName = quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? quoted?.[4] ?? null;
    if (quoted && quotedName !== null) {
        const afterQuotedLabel = tail.slice(quoted[0].length);
        if (!/^\s+(?:at|on)\s+beat\b/iu.test(afterQuotedLabel)) {
            return null;
        }
        return quotedName.trim() || null;
    }

    const beatClause = /\s+(?=(?:at|on)\s+beat\b)/iu.exec(tail);
    if (!beatClause) {
        return null;
    }
    const rationale = /\s+(?=(?:because\b|since\b|so\b|to\b|for\b|as\b|which\b|when\b|where\b))/iu.exec(tail);
    const nameEnd = Math.min(beatClause.index, rationale?.index ?? beatClause.index);
    const unquotedName = tail
        .slice(0, nameEnd)
        .replace(/[,:;.?!]+$/u, '')
        .trim();
    if (/\b(?:either|or)\b/iu.test(unquotedName)) {
        return null;
    }
    return unquotedName || null;
}

function getMarkerColorFromPrompt(promptText: string, values: readonly string[]): string | null {
    const beatReference = getMarkerBeatReference(promptText);
    if (!beatReference) {
        return null;
    }
    const colorNames = values
        .map(escapeRegExp)
        .sort((left, right) => right.length - left.length)
        .join('|');
    const suffix = promptText.slice(beatReference.endIndex);
    const mentions = [...suffix.matchAll(new RegExp(`\\b(${colorNames})\\b`, 'giu'))];
    if (mentions.length !== 1) {
        return null;
    }
    const destination = new RegExp(`^\\s*(?:,\\s*)?(?:to|as|colou?r(?:\\s+to)?)\\s+(${colorNames})\\b`, 'iu').exec(
        suffix
    );
    const color = destination?.[1];
    return color ? normalizePromptText(color) : null;
}

type MarkerBeatReference = {
    beat: number;
    endIndex: number;
};

function getMarkerBeatReference(promptText: string): MarkerBeatReference | null {
    const withoutQuotedLabels = promptText.replaceAll(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu, (quotedLabel) =>
        ' '.repeat(quotedLabel.length)
    );
    const matches = [...withoutQuotedLabels.matchAll(/\b(?:at|on)\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\b/giu)];
    if (matches.length !== 1) {
        return null;
    }
    const match = matches[0];
    const beat = Number(match?.[1]);
    if (!match || !Number.isFinite(beat)) {
        return null;
    }
    return { beat, endIndex: match.index + match[0].length };
}

function getMarkerBeatFromPrompt(promptText: string): number | null {
    return getMarkerBeatReference(promptText)?.beat ?? null;
}

type SectionRange = {
    endBeat: number;
    endIndex: number;
    startBeat: number;
    startIndex: number;
};

function getSectionRangeFromPrompt(promptText: string): SectionRange | null {
    const withoutQuotedLabels = promptText.replaceAll(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu, (quotedLabel) =>
        ' '.repeat(quotedLabel.length)
    );
    const matches = [
        ...withoutQuotedLabels.matchAll(
            /\bfrom\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+(?:to|through)\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\b/giu
        ),
    ];
    const match = matches.at(0);
    if (!match || matches.length !== 1) {
        return null;
    }
    const startBeat = Number(match[1]);
    const endBeat = Number(match[2]);
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0 || endBeat <= startBeat) {
        return null;
    }
    return {
        startBeat,
        endBeat,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
    };
}

function parseExplicitSectionName(value: string): string | null {
    const trimmed = value.trim();
    const quoted = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)$/u.exec(trimmed);
    const quotedName = quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? quoted?.[4];
    if (quotedName !== undefined) {
        return quotedName.trim() || null;
    }
    if (!trimmed || /\b(?:either|or)\b/iu.test(trimmed)) {
        return null;
    }
    return trimmed.replace(/[,:;.?!]+$/u, '').trim() || null;
}

function getSectionNameFromPrompt(promptText: string): string | null {
    const intent = /\b(?:add|create|remove|delete|rename)(?:\s+the|\s+a)?\s+section\b/iu.exec(promptText);
    const range = getSectionRangeFromPrompt(promptText);
    if (!intent || !range || range.startIndex <= intent.index + intent[0].length) {
        return null;
    }
    const assertedName = promptText.slice(intent.index + intent[0].length, range.startIndex).trim();
    const explicitLabel = /^(?:named|called)\s+(.+)$/iu.exec(assertedName);
    if (!explicitLabel) {
        return null;
    }
    const rawName = explicitLabel[1] ?? '';
    if (/^(?:"|'|“|‘)/u.test(rawName.trim())) {
        return parseExplicitSectionName(rawName);
    }
    const rationale = /\s+(?=(?:because|since|so|to|for|as|which|when|where)\b)/iu.exec(rawName);
    return parseExplicitSectionName(rawName.slice(0, rationale?.index ?? rawName.length));
}

function getSectionNewNameFromPrompt(promptText: string): string | null {
    if (!/\brename(?:\s+the)?\s+section\b/iu.test(promptText)) {
        return null;
    }
    const range = getSectionRangeFromPrompt(promptText);
    if (!range) {
        return null;
    }
    const suffix = promptText.slice(range.endIndex);
    const replacement = /^\s+(?:to|as)\s+(.+?)\s*$/iu.exec(suffix);
    if (!replacement) {
        return null;
    }
    const rawName = replacement[1] ?? '';
    const rationale = /\s+(?=(?:because|since|so|for|which|when|where)\b)/iu.exec(rawName);
    return parseExplicitSectionName(rawName.slice(0, rationale?.index ?? rawName.length));
}

function getValueMismatchReason(argument: string): string {
    return `Provider value ${argument} does not match the user request`;
}

function hasSelectedNoteScope(text: string): boolean {
    return (
        /\b(?:selected|current|these)(?: midi)? notes?\b/iu.test(text) ||
        /\b(?:midi )?notes? (?:that are |currently )?selected\b/iu.test(text) ||
        /\b(?:note selection|selection of (?:midi )?notes?)\b/iu.test(text)
    );
}

function validateBooleanIntentValue(
    valueRule: Extract<GroundingValueRule, { kind: 'boolean-intent' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope
): string | null {
    const trueIntent = valueRule.truePhrases.includes(actionScope.matchedIntentPhrase);
    const falseIntent = valueRule.falsePhrases.includes(actionScope.matchedIntentPhrase);
    if ((!trueIntent && !falseIntent) || assertedValue !== trueIntent) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function isExplicitSetPlaybackScope(actionScope: ActionPromptScope): boolean {
    let commandText = actionScope.text.trim();
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandText = commandText.replace(/^please\s+/iu, '');
    const normalized = normalizePromptText(commandText);
    return ['play', 'start playback', 'resume playback', 'pause', 'pause playback'].includes(normalized);
}

function isExplicitStopPlaybackPrompt(prompt: string): boolean {
    let commandText = prompt.trim();
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandText = commandText.replace(/^please\s+/iu, '');
    const normalized = normalizePromptText(commandText);
    return [
        'stop playback',
        'stop the playback',
        'stop transport',
        'stop the transport',
        'halt playback',
        'halt the playback',
        'halt transport',
        'halt the transport',
    ].includes(normalized);
}

type NumberValueRule = Extract<GroundingValueRule, { kind: 'number-if-present' }>;

function containsPromptPhrase(actionScope: ActionPromptScope, phrases: readonly string[]): boolean {
    return phrases.some((phrase) => getIntentPhraseIndex(actionScope.masked, phrase) >= 0);
}

function validateTrackGainDirection(
    assertedValue: number,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): boolean {
    const track = context.tracks.find((candidate) => candidate.id === groundedArguments.trackId);
    if (!track) {
        return false;
    }
    if (containsPromptPhrase(actionScope, ['louder', 'raise', 'turn up'])) {
        return assertedValue > track.gain;
    }
    if (containsPromptPhrase(actionScope, ['quieter', 'lower', 'turn down'])) {
        return assertedValue < track.gain;
    }
    return true;
}

function validateTrackPanDirection(assertedValue: number, actionScope: ActionPromptScope): boolean {
    if (containsPromptPhrase(actionScope, ['left'])) {
        return assertedValue < 0;
    }
    if (containsPromptPhrase(actionScope, ['right'])) {
        return assertedValue > 0;
    }
    if (containsPromptPhrase(actionScope, ['center'])) {
        return Math.abs(assertedValue) < 0.000_001;
    }
    return true;
}

function validateDeviceParameterDirection(
    assertedValue: number,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): boolean {
    const deviceId = groundedArguments.deviceId;
    const parameterId = groundedArguments.paramId;
    const parameter = context.tracks
        .flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)
        ?.parameters?.find((candidate) => candidate.id === parameterId);
    if (!parameter) {
        return false;
    }
    if (containsPromptPhrase(actionScope, ['increase'])) {
        return assertedValue > parameter.value;
    }
    if (containsPromptPhrase(actionScope, ['decrease'])) {
        return assertedValue < parameter.value;
    }
    return true;
}

function validateQualitativeNumberDirection(
    valueRule: NumberValueRule,
    assertedValue: number,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): boolean {
    if (valueRule.qualitativeDirection === 'track-gain') {
        return validateTrackGainDirection(assertedValue, actionScope, groundedArguments, context);
    }
    if (valueRule.qualitativeDirection === 'track-pan') {
        return validateTrackPanDirection(assertedValue, actionScope);
    }
    if (valueRule.qualitativeDirection === 'device-parameter') {
        return validateDeviceParameterDirection(assertedValue, actionScope, groundedArguments, context);
    }
    return true;
}

function getAutomationLaneValueRange(
    valueRule: NumberValueRule,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): AutomationLaneValueRange | null | undefined {
    if (valueRule.scale !== 'automation-lane-range') {
        return undefined;
    }
    const laneId = groundedArguments.laneId;
    const lane = (context.automationLanes ?? []).find((candidate) => candidate.id === laneId);
    if (!lane || !Number.isFinite(lane.minValue) || !Number.isFinite(lane.maxValue) || lane.maxValue < lane.minValue) {
        return null;
    }
    return lane;
}

function numbersMatch(valueRule: NumberValueRule, expected: number, asserted: number): boolean {
    if (valueRule.match === 'exact') {
        return Object.is(expected, asserted);
    }
    return Math.abs(expected - asserted) < 0.000_001;
}

function validateNumberValue(
    valueRule: NumberValueRule,
    assertedValue: unknown,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): string | null {
    const automationLane = getAutomationLaneValueRange(valueRule, groundedArguments, context);
    if (automationLane === null) {
        return getValueMismatchReason(valueRule.argument);
    }
    const expectedNumbers = getExpectedNumbers(actionScope, valueRule, automationLane);
    if (expectedNumbers === null) {
        return getValueMismatchReason(valueRule.argument);
    }
    if (assertedValue === undefined && valueRule.mayOmitWhenUnmentioned === true && expectedNumbers.length === 0) {
        return null;
    }
    if (typeof assertedValue !== 'number') {
        return getValueMismatchReason(valueRule.argument);
    }
    if (valueRule.mayOmitWhenUnmentioned === true && expectedNumbers.length === 0) {
        const defaultValue = valueRule.defaultWhenUnmentioned;
        if (defaultValue !== undefined && numbersMatch(valueRule, defaultValue, assertedValue)) {
            return null;
        }
        return getValueMismatchReason(valueRule.argument);
    }
    if (valueRule.requiredInPrompt === true && expectedNumbers.length === 0) {
        return getValueMismatchReason(valueRule.argument);
    }
    const matchesExpectedValue = expectedNumbers.some((expected) => numbersMatch(valueRule, expected, assertedValue));
    if (expectedNumbers.length > 0 && !matchesExpectedValue) {
        return getValueMismatchReason(valueRule.argument);
    }
    const matchesDirection = validateQualitativeNumberDirection(
        valueRule,
        assertedValue,
        actionScope,
        groundedArguments,
        context
    );
    return matchesDirection ? null : getValueMismatchReason(valueRule.argument);
}

function getConnectorBoundTimeSignatures(
    maskedScope: string,
    matches: readonly RegExpExecArray[],
    connectorName: 'from' | 'to'
): RegExpExecArray[] {
    const boundMatches: RegExpExecArray[] = [];
    const connectorPattern = new RegExp(`\\b${connectorName}\\b`, 'giu');
    for (const connector of maskedScope.matchAll(connectorPattern)) {
        const connectorEnd = connector.index + connector[0].length;
        const candidate = matches.find((item) => {
            if (item.index < connectorEnd) {
                return false;
            }
            return /^[\s:=]*$/u.test(maskedScope.slice(connectorEnd, item.index));
        });
        if (candidate && !boundMatches.includes(candidate)) {
            boundMatches.push(candidate);
        }
    }
    return boundMatches;
}

function isExplicitTimeSignatureDestination(actionScope: ActionPromptScope, match: RegExpExecArray): boolean {
    const fromConnector = /\bfrom\b/iu.exec(actionScope.masked);
    if (fromConnector && fromConnector.index < match.index) {
        return false;
    }
    const normalizedPrefix = normalizePromptText(actionScope.masked.slice(0, match.index));
    const normalizedIntent = normalizePromptText(actionScope.matchedIntentPhrase);
    const intentIndex = normalizedPrefix.lastIndexOf(normalizedIntent);
    if (intentIndex < 0) {
        return false;
    }
    const intentSuffix = normalizedPrefix.slice(intentIndex + normalizedIntent.length).trim();
    return (
        intentSuffix.length === 0 ||
        intentSuffix === 'to' ||
        intentSuffix === 'as' ||
        intentSuffix === 'at' ||
        intentSuffix.endsWith(' to') ||
        intentSuffix.endsWith(' as')
    );
}

function validateTimeSignatureValue(
    valueRule: Extract<GroundingValueRule, { kind: 'time-signature' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): string | null {
    if (/\b(?:either|or)\b/iu.test(actionScope.masked)) {
        return `Provider value ${valueRule.argument} is not grounded in the user request`;
    }
    const matches = [...actionScope.masked.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/gu)];
    let match = matches.length === 1 ? matches[0] : null;
    if (match && !isExplicitTimeSignatureDestination(actionScope, match)) {
        match = null;
    }
    if (matches.length === 2) {
        const sourceMatches = getConnectorBoundTimeSignatures(actionScope.masked, matches, 'from');
        const destinationMatches = getConnectorBoundTimeSignatures(actionScope.masked, matches, 'to');
        const source = sourceMatches[0];
        const destination = destinationMatches[0];
        const sourceNumerator = Number.parseInt(source?.[1] ?? '', 10);
        const sourceDenominator = Number.parseInt(source?.[2] ?? '', 10);
        if (
            sourceMatches.length === 1 &&
            destinationMatches.length === 1 &&
            source === matches[0] &&
            destination === matches[1] &&
            sourceNumerator === context.timeSignature[0] &&
            sourceDenominator === context.timeSignature[1]
        ) {
            match = destination;
        }
    }
    if (!match) {
        return `Provider value ${valueRule.argument} is not grounded in the user request`;
    }
    const numerator = Number.parseInt(match[1] ?? '', 10);
    const denominator = Number.parseInt(match[2] ?? '', 10);
    if (assertedValue !== numerator || groundedArguments[valueRule.denominatorArgument] !== denominator) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateStringLiteralValue(
    valueRule: Extract<GroundingValueRule, { kind: 'string-literal' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope,
    context: ProjectContext
): string | null {
    if (typeof assertedValue !== 'string') {
        return getValueMismatchReason(valueRule.argument);
    }
    if (valueRule.argument === 'deviceType') {
        const normalizedAssertedValue = normalizePromptText(assertedValue);
        const matchingDeviceTypes = (context.availableDeviceTypes ?? []).filter(
            (deviceType) =>
                normalizePromptText(deviceType.id) === normalizedAssertedValue ||
                normalizePromptText(deviceType.name) === normalizedAssertedValue
        );
        if (
            matchingDeviceTypes.length === 1 &&
            [matchingDeviceTypes[0]!.id, matchingDeviceTypes[0]!.name].some(
                (reference) => getIntentPhraseIndex(actionScope.masked, reference) >= 0
            )
        ) {
            return null;
        }
    }
    if (valueRule.argument === 'parameterId') {
        const normalizedAssertedValue = normalizePromptText(assertedValue);
        let aliases: readonly string[] = [];
        if (normalizedAssertedValue === 'gain') {
            aliases = ['gain', 'volume', 'fader', 'level'];
        } else if (normalizedAssertedValue === 'pan') {
            aliases = ['pan', 'panning'];
        }
        if (aliases.some((alias) => getIntentPhraseIndex(actionScope.masked, alias) >= 0)) {
            return null;
        }
        return getValueMismatchReason(valueRule.argument);
    }
    if (getIntentPhraseIndex(actionScope.masked, assertedValue) < 0) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateEnumValue(
    valueRule: Extract<GroundingValueRule, { kind: 'enum-if-present' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope
): string | null {
    const mentionedValues = valueRule.values.filter((value) => {
        const phrases = [value, ...(valueRule.aliases?.[value] ?? [])];
        return phrases.some((phrase) => getIntentPhraseIndex(actionScope.masked, phrase) >= 0);
    });
    if (mentionedValues.length > 1) {
        return getValueMismatchReason(valueRule.argument);
    }
    if (mentionedValues.length === 1) {
        if (mentionedValues[0] === assertedValue) {
            return null;
        }
        return getValueMismatchReason(valueRule.argument);
    }
    if (assertedValue === undefined && valueRule.mayOmitWhenUnmentioned === true) {
        return null;
    }
    if (valueRule.defaultWhenUnmentioned !== undefined) {
        return assertedValue === valueRule.defaultWhenUnmentioned ? null : getValueMismatchReason(valueRule.argument);
    }
    if (valueRule.requiredInPrompt === true) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateTextAfterKeywordValue(
    valueRule: Extract<GroundingValueRule, { kind: 'text-after-keyword-if-present' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope
): string | null {
    const expectedValue = valueRule.terminators
        ? (getAddClipPromptEvidence(actionScope)?.name ?? null)
        : getTextAfterKeyword(actionScope, valueRule.keywords);
    if (expectedValue === null) {
        return valueRule.requiredInPrompt === true ? getValueMismatchReason(valueRule.argument) : null;
    }
    if (typeof assertedValue !== 'string') {
        return getValueMismatchReason(valueRule.argument);
    }
    if (normalizePromptText(assertedValue) !== normalizePromptText(expectedValue)) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateTextAfterConnectorValue(
    valueRule: Extract<GroundingValueRule, { kind: 'text-after-connector' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope
): string | null {
    const separator = new RegExp(`\\b${valueRule.connector}\\b`, 'iu').exec(actionScope.masked);
    if (!separator || typeof assertedValue !== 'string') {
        return `Provider value ${valueRule.argument} is not grounded in the user request`;
    }
    const expectedValue = actionScope.text.slice(separator.index + separator[0].length).trim();
    if (normalizePromptText(assertedValue) !== normalizePromptText(expectedValue)) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateGroundedValue(
    valueRule: GroundingValueRule,
    assertedValue: unknown,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): string | null {
    switch (valueRule.kind) {
        case 'boolean-intent':
            return validateBooleanIntentValue(valueRule, assertedValue, actionScope);
        case 'number-if-present':
            return validateNumberValue(valueRule, assertedValue, actionScope, groundedArguments, context);
        case 'marker-beat': {
            const expectedBeat = getMarkerBeatFromPrompt(actionScope.text);
            return assertedValue === expectedBeat ? null : getValueMismatchReason(valueRule.argument);
        }
        case 'section-start-beat':
        case 'section-end-beat': {
            const range = getSectionRangeFromPrompt(actionScope.text);
            const expectedBeat = valueRule.kind === 'section-start-beat' ? range?.startBeat : range?.endBeat;
            return assertedValue === expectedBeat ? null : getValueMismatchReason(valueRule.argument);
        }
        case 'time-signature':
            return validateTimeSignatureValue(valueRule, assertedValue, actionScope, groundedArguments, context);
        case 'string-literal':
            return validateStringLiteralValue(valueRule, assertedValue, actionScope, context);
        case 'enum-if-present':
            return validateEnumValue(valueRule, assertedValue, actionScope);
        case 'text-after-keyword-if-present':
            return validateTextAfterKeywordValue(valueRule, assertedValue, actionScope);
        case 'marker-name': {
            const expectedValue = getMarkerNameFromPrompt(actionScope.text);
            if (
                expectedValue === null ||
                typeof assertedValue !== 'string' ||
                normalizePromptText(assertedValue) !== normalizePromptText(expectedValue)
            ) {
                return getValueMismatchReason(valueRule.argument);
            }
            return null;
        }
        case 'marker-reference': {
            const expectedValue = getMarkerReferenceNameFromPrompt(actionScope.text);
            if (
                expectedValue === null ||
                typeof assertedValue !== 'string' ||
                normalizePromptText(assertedValue) !== normalizePromptText(expectedValue)
            ) {
                return getValueMismatchReason(valueRule.argument);
            }
            return null;
        }
        case 'marker-color': {
            const expectedValue = getMarkerColorFromPrompt(actionScope.text, valueRule.values);
            if (
                expectedValue === null ||
                typeof assertedValue !== 'string' ||
                normalizePromptText(assertedValue) !== expectedValue
            ) {
                return getValueMismatchReason(valueRule.argument);
            }
            return null;
        }
        case 'section-name':
        case 'section-reference': {
            let expectedValue = getSectionNameFromPrompt(actionScope.text);
            if (expectedValue === null && valueRule.kind === 'section-reference') {
                const matches = (context.sections ?? []).filter((section) =>
                    ` ${normalizePromptText(actionScope.text)} `.includes(` ${normalizePromptText(section.name)} `)
                );
                expectedValue = matches.length === 1 ? matches[0]!.name : null;
            }
            if (
                expectedValue === null ||
                typeof assertedValue !== 'string' ||
                normalizePromptText(assertedValue) !== normalizePromptText(expectedValue)
            ) {
                return getValueMismatchReason(valueRule.argument);
            }
            return null;
        }
        case 'section-new-name': {
            const expectedValue = getSectionNewNameFromPrompt(actionScope.text);
            if (
                expectedValue === null ||
                typeof assertedValue !== 'string' ||
                normalizePromptText(assertedValue) !== normalizePromptText(expectedValue)
            ) {
                return getValueMismatchReason(valueRule.argument);
            }
            return null;
        }
        case 'text-after-connector':
            return validateTextAfterConnectorValue(valueRule, assertedValue, actionScope);
        default:
            return valueRule;
    }
}

function validateGroundedValues(
    groundingRules: GroundingRules,
    groundedArguments: Record<string, unknown>,
    actionScope: ActionPromptScope,
    context: ProjectContext
): string | null {
    for (const valueRule of groundingRules.valueRules) {
        const assertedValue = groundedArguments[valueRule.argument];
        const valueRejection = validateGroundedValue(valueRule, assertedValue, actionScope, groundedArguments, context);
        if (valueRejection) {
            return valueRejection;
        }
    }
    return null;
}

type ResolveAgentReferenceArrayResult =
    | { status: 'resolved'; ids: string[] }
    | { status: 'rejected'; reason: 'ambiguous-target' | 'asserted-target-mismatch' | 'ungrounded-target' };

function resolveAgentReferenceArray({
    assertedIds,
    capability,
    context,
    dependencyId,
    prompt,
}: {
    assertedIds: unknown;
    capability: GroundingRules['targetRules'][number]['capability'];
    context: ProjectContext;
    dependencyId?: unknown;
    prompt: string;
}): ResolveAgentReferenceArrayResult {
    if (
        !Array.isArray(assertedIds) ||
        assertedIds.length === 0 ||
        !assertedIds.every((id): id is string => typeof id === 'string' && id.length > 0) ||
        new Set(assertedIds).size !== assertedIds.length
    ) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (capability === 'editable-clip' && /\bselected clips\b/u.test(normalizePromptText(prompt))) {
        const selectedIds = new Set(context.selectedClipIds);
        const assertedIdSet = new Set(assertedIds);
        if (selectedIds.size === assertedIdSet.size && [...selectedIds].every((id) => assertedIdSet.has(id))) {
            return { status: 'resolved', ids: [...assertedIds] };
        }
        return { status: 'rejected', reason: 'asserted-target-mismatch' };
    }
    let candidates: Array<{ id: string; name: string }>;
    if (capability === 'routable-source') {
        candidates = context.tracks.filter(
            (track) =>
                (track.kind === 'audio' || track.kind === 'midi' || track.kind === 'bus') &&
                (typeof dependencyId !== 'string' || track.sends?.some((send) => send.busId === dependencyId))
        );
        if (/\bevery vocal send\b/u.test(normalizePromptText(prompt))) {
            const vocalIds = new Set(
                candidates
                    .filter((candidate) => /\bvocal\b/u.test(normalizePromptText(candidate.name)))
                    .map((candidate) => candidate.id)
            );
            const assertedIdSet = new Set(assertedIds);
            if (
                vocalIds.size > 0 &&
                vocalIds.size === assertedIdSet.size &&
                [...vocalIds].every((id) => assertedIdSet.has(id))
            ) {
                return { status: 'resolved', ids: [...assertedIds] };
            }
            return { status: 'rejected', reason: 'asserted-target-mismatch' };
        }
    } else if (capability === 'vca-member-track') {
        candidates = context.tracks.filter(
            (track) =>
                track.kind === 'audio' || track.kind === 'midi' || track.kind === 'bus' || track.kind === 'folder'
        );
    } else if (capability === 'editable-clip') {
        candidates = context.tracks.flatMap((track) => track.clips);
    } else {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    const evidenced = candidates.flatMap((candidate) => {
        const result = resolveAgentReference({
            prompt,
            assertedId: candidate.id,
            capability,
            context,
            excludedIds: candidates.filter((other) => other.id !== candidate.id).map((other) => other.id),
        });
        if (result.status !== 'resolved') {
            return [];
        }
        return [{ candidate, evidence: result.evidence }];
    });
    const withoutShadowedDuplicateNames = evidenced.filter(({ candidate, evidence }) => {
        if (evidence !== 'exact-name') {
            return true;
        }
        const normalizedName = normalizePromptText(candidate.name);
        return !evidenced.some(
            ({ candidate: other, evidence: otherEvidence }) =>
                otherEvidence === 'literal-id' && normalizePromptText(other.name) === normalizedName
        );
    });
    const withoutOverlappedNames = withoutShadowedDuplicateNames.filter(({ candidate, evidence }) => {
        if (evidence !== 'exact-name') {
            return true;
        }
        const normalizedName = normalizePromptText(candidate.name);
        return !evidenced.some(
            ({ candidate: other, evidence: otherEvidence }) =>
                other.id !== candidate.id &&
                otherEvidence === 'exact-name' &&
                normalizePromptText(other.name).length > normalizedName.length &&
                ` ${normalizePromptText(other.name)} `.includes(` ${normalizedName} `)
        );
    });
    if (withoutOverlappedNames.length === 0) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    const hasAmbiguousName = withoutOverlappedNames.some(({ candidate, evidence }) => {
        if (evidence !== 'exact-name') {
            return false;
        }
        const normalizedName = normalizePromptText(candidate.name);
        return candidates.some(
            (other) => other.id !== candidate.id && normalizePromptText(other.name) === normalizedName
        );
    });
    if (hasAmbiguousName) {
        return { status: 'rejected', reason: 'ambiguous-target' };
    }

    const evidencedIds = new Set(withoutOverlappedNames.map(({ candidate }) => candidate.id));
    const assertedIdSet = new Set(assertedIds);
    if (evidencedIds.size !== assertedIdSet.size || [...evidencedIds].some((id) => !assertedIdSet.has(id))) {
        return { status: 'rejected', reason: 'asserted-target-mismatch' };
    }
    return { status: 'resolved', ids: [...assertedIds] };
}

function validateRemoveFromVcaGroupEvidence(
    actionScope: ActionPromptScope,
    trackId: unknown,
    context: ProjectContext
): string | null {
    if (typeof trackId !== 'string') {
        return 'Provider VCA membership target is not grounded in the user request';
    }
    const referencedGroupIds = new Set<string>();
    let hasAmbiguousGroupReference = false;
    for (const group of context.vcaGroups ?? []) {
        const result = resolveAgentReference({
            prompt: actionScope.text,
            assertedId: group.id,
            capability: 'vca-group',
            context,
        });
        if (result.status === 'resolved') {
            referencedGroupIds.add(result.id);
        } else if (result.reason === 'ambiguous-target') {
            hasAmbiguousGroupReference = true;
        }
    }
    if (referencedGroupIds.size === 0 && !hasAmbiguousGroupReference) {
        return null;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    const currentGroupIds = new Set(
        (context.vcaGroups ?? [])
            .filter((group) => group.trackIds.includes(trackId) || group.id === track?.vcaGroupId)
            .map((group) => group.id)
    );
    if (
        hasAmbiguousGroupReference ||
        referencedGroupIds.size !== 1 ||
        currentGroupIds.size !== 1 ||
        !currentGroupIds.has([...referencedGroupIds][0]!)
    ) {
        return 'Provider VCA group reference does not match the track current membership';
    }
    return null;
}

function groundToolCall({
    actionOrdinal,
    batchLocalBusBindings,
    call,
    catalog,
    context,
    declaredBatchLocalBusBindings,
    index,
    prompt,
    plannedActionNames,
    resolvedTargetOverrides,
    sameActionAssertedArguments,
    sameActionCallCount,
    visibleGroundedCalls,
    visiblePlannedTrackCreations,
    workflowCapabilityId,
}: GroundToolCallInput): ToolCallResult | LlmActionRejection {
    if (call.name === 'stopPlayback' && !isExplicitStopPlaybackPrompt(prompt)) {
        return rejection(index, call.name, 'Provider action is not grounded in an explicit transport-stop request');
    }
    if (call.name === 'setClipLoopLength' && !isExplicitClipLoopLengthPrompt(prompt)) {
        return rejection(
            index,
            call.name,
            'Provider clip loop-length action requires one direct named or selected clip request in beats'
        );
    }
    const groundingRules = getExecutableAppActionGroundingRules(call.name);
    if (!groundingRules) {
        return call;
    }
    const actionScope = resolveActionPromptScope({
        actionName: call.name,
        actionOrdinal,
        assertedArguments: call.arguments,
        catalog,
        compilerExpandedTargets: resolvedTargetOverrides !== undefined,
        context,
        prompt,
        plannedActionNames,
        sameActionAssertedArguments,
        sameActionCallCount,
        workflowCapabilityId,
    });
    if (!actionScope) {
        return rejection(index, call.name, 'Provider action is not grounded in the user request');
    }
    if (
        call.name === 'moveClip' &&
        !hasGroundedMoveBeatAssertions({
            catalog,
            context,
            expectedMoveCount: sameActionCallCount,
            plannedActionNames,
            prompt,
        })
    ) {
        return rejection(index, call.name, 'Provider clip move requires exactly one explicit absolute beat per move');
    }
    if (
        call.name === 'splitClip' &&
        !hasGroundedSplitBeatAssertions({
            catalog,
            context,
            expectedSplitCount: sameActionCallCount,
            plannedActionNames,
            prompt,
        })
    ) {
        return rejection(index, call.name, 'Provider clip split requires exactly one explicit absolute beat per split');
    }
    if (
        call.name === 'addClip' &&
        !hasGroundedAddClipAssertions({
            catalog,
            context,
            expectedAddClipCount: sameActionCallCount,
            plannedActionNames,
            prompt,
        })
    ) {
        return rejection(index, call.name, 'Provider clip creation requires one exact explicit beat range per clip');
    }
    if (call.name === 'setPlayback' && !isExplicitSetPlaybackScope(actionScope)) {
        return rejection(index, call.name, 'Provider action is not grounded in an explicit playback request');
    }
    const groundedArguments = { ...call.arguments };
    const bulkDeviceInsertionTargetIds =
        call.name === 'addDevice' ? (getBulkDeviceInsertionTrackScope(prompt, context)?.targetIds ?? null) : null;
    const bulkMutedEmptyTrackDeletionTargetIds =
        call.name === 'removeTrack' ? (getMutedEmptyTrackDeletionScope(prompt, context)?.targetIds ?? null) : null;
    const drumRoutingScope =
        call.name === 'setTrackOutput' && workflowCapabilityId === 'drum-routing'
            ? getDrumRoutingPromptScope(context)
            : null;
    const articulationTransferScope =
        call.name === 'copyMidiArticulations' && workflowCapabilityId === 'articulation-transfer'
            ? getArticulationTransferPromptScope(context)
            : null;
    const sidechainRoutingScope =
        call.name === 'addSidechainRoute' ? getSidechainRoutingPromptScope(prompt, context) : null;
    const wholeProjectVibeMixScope =
        call.name === 'automateTrackGainRange' ? getWholeProjectVibeMixScope(prompt, context) : null;
    for (const targetRule of groundingRules.targetRules) {
        const assertedValue = groundedArguments[targetRule.argument];
        if (targetRule.optional && assertedValue === undefined) {
            continue;
        }
        const targetPrompt = getTargetPromptScope(actionScope, targetRule.promptRole);
        if (
            articulationTransferScope?.status === 'request' &&
            call.name === 'copyMidiArticulations' &&
            articulationTransferScope.clipPairs.some(
                (pair) =>
                    pair.sourceClipId === groundedArguments.sourceClipId &&
                    pair.targetClipId === groundedArguments.targetClipId
            ) &&
            (targetRule.argument === 'sourceClipId' || targetRule.argument === 'targetClipId')
        ) {
            continue;
        }
        if (
            sidechainRoutingScope?.status === 'request' &&
            call.name === 'addSidechainRoute' &&
            (targetRule.argument === 'sourceTrackId' || targetRule.argument === 'targetTrackId') &&
            sidechainRoutingScope.routes.some(
                (route) =>
                    route.sourceTrackId === groundedArguments.sourceTrackId &&
                    route.targetTrackId === groundedArguments.targetTrackId &&
                    route.targetDeviceId === groundedArguments.targetDeviceId
            )
        ) {
            continue;
        }
        if (
            wholeProjectVibeMixScope &&
            call.name === 'automateTrackGainRange' &&
            targetRule.argument === 'trackIds' &&
            hasExactTargetIdSet(assertedValue, wholeProjectVibeMixScope.targetIds)
        ) {
            continue;
        }
        if (
            drumRoutingScope?.status === 'request' &&
            call.name === 'setTrackOutput' &&
            targetRule.argument === 'trackId' &&
            typeof assertedValue === 'string' &&
            drumRoutingScope.targetIds.includes(assertedValue)
        ) {
            continue;
        }
        if (
            bulkDeviceInsertionTargetIds &&
            call.name === 'addDevice' &&
            targetRule.argument === 'trackId' &&
            typeof assertedValue === 'string' &&
            bulkDeviceInsertionTargetIds.includes(assertedValue)
        ) {
            continue;
        }
        if (
            bulkMutedEmptyTrackDeletionTargetIds &&
            call.name === 'removeTrack' &&
            targetRule.argument === 'trackId' &&
            typeof assertedValue === 'string' &&
            bulkMutedEmptyTrackDeletionTargetIds.includes(assertedValue)
        ) {
            continue;
        }
        const compilerTargetOverride = resolvedTargetOverrides?.find(
            (override) => override.argument === targetRule.argument
        );
        if (
            call.name === 'addSidechainRoute' &&
            targetRule.argument === 'targetDeviceId' &&
            compilerTargetOverride === undefined
        ) {
            // Only the final bridge owns provider device admission. It accepts an
            // app-enumerated MF-06 route and rejects every unadmitted device ID.
            continue;
        }
        if (
            targetRule.cardinality === 'many' &&
            compilerTargetOverride !== undefined &&
            'stableIds' in compilerTargetOverride
        ) {
            if (
                compilerTargetOverride.cardinality !== 'many' ||
                targetRule.capability !== compilerTargetOverride.capability ||
                JSON.stringify(assertedValue) !== JSON.stringify(compilerTargetOverride.stableIds)
            ) {
                return rejection(
                    index,
                    call.name,
                    `Compiler-resolved target ${targetRule.argument} does not match the command target contract`
                );
            }
            groundedArguments[targetRule.argument] = [...compilerTargetOverride.stableIds];
            continue;
        }
        if (targetRule.cardinality === 'many') {
            const dependencyValue = targetRule.dependsOn ? groundedArguments[targetRule.dependsOn] : undefined;
            const result = resolveAgentReferenceArray({
                assertedIds: assertedValue,
                capability: targetRule.capability,
                context,
                dependencyId: dependencyValue,
                prompt: targetPrompt,
            });
            if (result.status === 'rejected') {
                if (result.reason === 'ambiguous-target') {
                    return rejection(
                        index,
                        call.name,
                        `Target ${targetRule.argument} is ambiguous in the user request`
                    );
                }
                if (result.reason === 'asserted-target-mismatch') {
                    return rejection(
                        index,
                        call.name,
                        `Provider target ${targetRule.argument} does not match the exactly grounded project references`
                    );
                }
                return rejection(index, call.name, `Target ${targetRule.argument} is not grounded in the user request`);
            }
            groundedArguments[targetRule.argument] = result.ids;
            continue;
        }
        const dependencyValue = targetRule.dependsOn ? groundedArguments[targetRule.dependsOn] : undefined;
        const distinctValue = targetRule.distinctFrom ? groundedArguments[targetRule.distinctFrom] : undefined;
        if (targetRule.distinctFrom && typeof distinctValue === 'string' && assertedValue === distinctValue) {
            return rejection(
                index,
                call.name,
                `Target ${targetRule.argument} must be distinct from ${targetRule.distinctFrom}`
            );
        }
        const batchLocalReference = resolveBatchLocalBusReference(
            assertedValue,
            index,
            batchLocalBusBindings,
            declaredBatchLocalBusBindings
        );
        if (batchLocalReference.status === 'rejected') {
            return rejection(index, call.name, batchLocalReference.reason);
        }
        if (batchLocalReference.status === 'resolved') {
            if (targetRule.allowBatchLocal === false) {
                return rejection(
                    index,
                    call.name,
                    `Target ${targetRule.argument} must already exist in project context`
                );
            }
            if (!batchLocalBusCapabilities.has(targetRule.capability)) {
                return rejection(
                    index,
                    call.name,
                    `Batch-local bus cannot satisfy target capability ${targetRule.capability}`
                );
            }
            if (compilerTargetOverride !== undefined && 'batchLocalBinding' in compilerTargetOverride) {
                if (
                    compilerTargetOverride.capability !== targetRule.capability ||
                    compilerTargetOverride.batchLocalBinding !== batchLocalReference.binding.binding
                ) {
                    return rejection(
                        index,
                        call.name,
                        `Compiler-resolved target ${targetRule.argument} does not match the command target contract`
                    );
                }
                groundedArguments[targetRule.argument] = batchLocalReference.binding.busId;
                continue;
            }
            if (
                !containsBatchLocalBusEvidence(
                    targetPrompt,
                    batchLocalReference.binding,
                    targetRule.capability,
                    context,
                    batchLocalBusBindings,
                    visibleGroundedCalls,
                    visiblePlannedTrackCreations
                )
            ) {
                return rejection(
                    index,
                    call.name,
                    `Batch-local target ${targetRule.argument} is not unambiguously grounded in the user request`
                );
            }
            groundedArguments[targetRule.argument] = batchLocalReference.binding.busId;
            continue;
        }
        if (compilerTargetOverride !== undefined && 'stableIds' in compilerTargetOverride) {
            if (
                compilerTargetOverride.cardinality !== 'one' ||
                compilerTargetOverride.stableIds.length !== 1 ||
                targetRule.capability !== compilerTargetOverride.capability ||
                assertedValue !== compilerTargetOverride.stableIds[0]
            ) {
                return rejection(
                    index,
                    call.name,
                    `Compiler-resolved target ${targetRule.argument} does not match the command target contract`
                );
            }
            groundedArguments[targetRule.argument] = compilerTargetOverride.stableIds[0];
            continue;
        }
        const bulkSiblingTargetIds =
            call.name === 'setTrackOutput' && targetRule.argument === 'trackId'
                ? sameActionAssertedArguments.flatMap((arguments_) => {
                      const trackId = arguments_.trackId;
                      if (typeof trackId !== 'string' || trackId === assertedValue) {
                          return [];
                      }
                      return [trackId];
                  })
                : [];
        const result = resolveAgentReference({
            prompt: targetPrompt,
            assertedId: assertedValue,
            capability: targetRule.capability,
            context,
            dependencyId: typeof dependencyValue === 'string' ? dependencyValue : undefined,
            excludedIds: [...(typeof distinctValue === 'string' ? [distinctValue] : []), ...bulkSiblingTargetIds],
        });
        if (result.status === 'rejected') {
            if (result.reason === 'ambiguous-target') {
                return rejection(index, call.name, `Target ${targetRule.argument} is ambiguous in the user request`);
            }
            if (result.reason === 'asserted-target-mismatch') {
                return rejection(
                    index,
                    call.name,
                    `Provider target ${targetRule.argument} does not match the uniquely grounded project reference`
                );
            }
            return rejection(index, call.name, `Target ${targetRule.argument} is not grounded in the user request`);
        }

        groundedArguments[targetRule.argument] = result.id;
    }
    if (call.name === 'moveClip' && !isDirectMoveClipDestination(actionScope, groundedArguments.trackId, context)) {
        return rejection(index, call.name, 'Provider clip destination is not the direct object of the move request');
    }
    if (call.name === 'glueClips' && !isDirectGlueClipPairScope(actionScope, groundedArguments.clipIds, context)) {
        return rejection(index, call.name, 'Provider clips are not the direct objects of one glue request');
    }
    if (call.name === 'splitClip' && !isDirectSplitClipScope(actionScope, groundedArguments.clipId, context)) {
        return rejection(index, call.name, 'Provider clip split is not scoped to the whole clip');
    }
    if (call.name === 'addClip') {
        const evidence = getAddClipPromptEvidence(actionScope);
        if (
            !evidence ||
            groundedArguments.startBeat !== evidence.startBeat ||
            groundedArguments.endBeat !== evidence.endBeat ||
            typeof groundedArguments.name !== 'string' ||
            normalizePromptText(groundedArguments.name) !== normalizePromptText(evidence.name)
        ) {
            return rejection(
                index,
                call.name,
                'Provider clip creation does not match one explicit name and beat range'
            );
        }
        if (!isDirectAddClipTarget(evidence.targetText, groundedArguments.trackId, context)) {
            return rejection(
                index,
                call.name,
                'Provider clip container is not the direct object of the creation request'
            );
        }
    }
    if (
        call.name === 'removeTrack' &&
        !bulkMutedEmptyTrackDeletionTargetIds?.includes(String(groundedArguments.trackId)) &&
        !isExplicitTrackDeletionScope({
            context,
            text: actionScope.text,
            trackId: groundedArguments.trackId,
        })
    ) {
        return rejection(index, call.name, 'Provider track deletion is not explicit in the user request');
    }
    if (
        call.name === 'removeClip' &&
        !isExplicitClipDeletionScope({
            context,
            text: actionScope.text,
            clipId: groundedArguments.clipId,
        })
    ) {
        return rejection(index, call.name, 'Provider clip deletion is not explicit in the user request');
    }
    if (call.name === 'clearSolos' && classifyClearSolosScope(actionScope, context) !== 'universal') {
        return rejection(index, call.name, 'Provider clear-solos scope is not explicitly universal');
    }
    if (call.name === 'removeFromVca') {
        const vcaGroupRejection = validateRemoveFromVcaGroupEvidence(actionScope, groundedArguments.trackId, context);
        if (vcaGroupRejection) {
            return rejection(index, call.name, vcaGroupRejection);
        }
    }
    if (
        (call.name === 'quantizeNotes' ||
            call.name === 'transposeNotes' ||
            call.name === 'invertNotes' ||
            call.name === 'retrogradeNotes' ||
            call.name === 'quantizeNoteLengths' ||
            call.name === 'scaleAllVelocities' ||
            call.name === 'setAllVelocities') &&
        (hasSelectedNoteScope(actionScope.text) || (plannedActionNames.length === 1 && hasSelectedNoteScope(prompt)))
    ) {
        return rejection(index, call.name, 'Selected-note edits are not supported; target the whole MIDI clip');
    }
    const valueRejection = validateGroundedValues(groundingRules, groundedArguments, actionScope, context);
    if (valueRejection) {
        return rejection(index, call.name, valueRejection);
    }

    return { ...call, arguments: groundedArguments };
}

function hasExplicitPromptIntent(prompt: string, catalog: GroundingCatalog, actionName: string): boolean {
    return getPromptClauses(prompt, prompt).some(
        (clause) => resolveClauseActionIntent(clause.masked, catalog)?.actionType === actionName
    );
}

type PromptActionRequest = {
    actionType: string;
    cancelled: boolean;
    clause: PromptClause;
};

type PromptActionAnalysis = {
    cancellationClauses: ReadonlySet<PromptClause>;
    clauses: readonly PromptClause[];
    requests: readonly PromptActionRequest[];
};

function analyzePromptActionRequests(prompt: string, catalog: GroundingCatalog): PromptActionAnalysis {
    const maskedPrompt = maskQuotedLabels(prompt);
    const clauses = getPromptClauses(prompt, maskedPrompt);
    const cancellationClauses = new Set<PromptClause>();
    const requests: PromptActionRequest[] = [];
    for (const clause of clauses) {
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (intent) {
            requests.push({ actionType: intent.actionType, cancelled: false, clause });
        }

        for (const cue of getCancellationCues(clause.masked.toLocaleLowerCase())) {
            const referencedAction = getReferencedCancellationAction(cue, catalog);
            let requestIndex = -1;
            for (let index = requests.length - 1; index >= 0; index -= 1) {
                const request = requests[index];
                if (request && !request.cancelled && (!referencedAction || request.actionType === referencedAction)) {
                    requestIndex = index;
                    break;
                }
            }
            const cancelledRequest = requests[requestIndex];
            if (cancelledRequest) {
                requests[requestIndex] = { ...cancelledRequest, cancelled: true };
                cancellationClauses.add(clause);
            }
        }
    }
    return { cancellationClauses, clauses, requests };
}

function isPunchActionType(actionType: string): actionType is 'setPunchIn' | 'setPunchOut' | 'setPunchEnabled' {
    return actionType === 'setPunchIn' || actionType === 'setPunchOut' || actionType === 'setPunchEnabled';
}

function hasPunchFamilyReference(prompt: string): boolean {
    return /\bpunch\b/u.test(normalizePromptText(maskQuotedLabels(prompt)));
}

function hasClipLoopLengthFamilyReference(prompt: string): boolean {
    return /\bclip loop length\b/u.test(normalizePromptText(maskQuotedLabels(prompt)));
}

function isExactPunchCommandClause(clause: PromptClause): boolean {
    let commandSource = clause.masked.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    return /^(?:set|move)\s+punch(?:\s+|-)\s*(?:in|out)\s+(?:(?:at|to)\s+)?beat\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*[?!]?$/iu.test(
        commandSource
    );
}

function isExactPunchEnabledCommandClause(clause: PromptClause): boolean {
    let commandSource = clause.masked.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    return /^(?:(?:enable|disable)\s+punch\s+(?:in\s*\/\s*out|mode)|turn\s+punch\s+(?:in\s*\/\s*out|mode)\s+(?:on|off))(?:\s+please)?\s*[?!.]?$/iu.test(
        commandSource
    );
}

function isExactPunchActionCommandClause(request: PromptActionRequest): boolean {
    if (request.actionType === 'setPunchEnabled') {
        return isExactPunchEnabledCommandClause(request.clause);
    }
    return isExactPunchCommandClause(request.clause);
}

function isPunchPromptFullyCovered(analysis: PromptActionAnalysis): boolean {
    const requestClauses = new Set(analysis.requests.map((request) => request.clause));
    return analysis.clauses.every(
        (clause) =>
            requestClauses.has(clause) ||
            analysis.cancellationClauses.has(clause) ||
            normalizePromptText(clause.masked).length === 0
    );
}

function isExactClipLoopLengthCommandClause(request: PromptActionRequest): boolean {
    return request.actionType === 'setClipLoopLength' && isExplicitClipLoopLengthPrompt(request.clause.masked);
}

function isClipLoopLengthPromptFullyCovered(analysis: PromptActionAnalysis): boolean {
    const requestClauses = new Set(analysis.requests.map((request) => request.clause));
    return analysis.clauses.every(
        (clause) =>
            requestClauses.has(clause) ||
            analysis.cancellationClauses.has(clause) ||
            normalizePromptText(clause.masked).length === 0
    );
}

function hasMalformedPunchNumericContinuation(maskedPrompt: string): boolean {
    return /\b(?:set|move)\s+punch(?:\s+|-)\s*(?:in|out)\b[^;.\n]*?\bbeat\s+[+-]?(?:\d+\.\d+|\d+(?!\.\d)|\.\d+)\s*(?:,\s*|\.\s*\.\s*)[+-]?(?:\d|\.\d)/iu.test(
        maskedPrompt
    );
}

export function bridgeGroundedLlmToolCalls({
    calls,
    context,
    markerSignatures = [],
    sectionSignatures = [],
    prompt,
    compilerEvidence,
    projectRevision,
    workflowCapabilityId,
}: BridgeGroundedLlmToolCallsInput): BridgeGroundedLlmToolCallsResult {
    let compilerTargetOverridesByCallIndex: ReadonlyMap<number, readonly CompilerResolvedTargetOverride[]> | undefined;
    let compilerActionCommandGraph: ActionCommandGraph | undefined;
    if (compilerEvidence !== undefined) {
        const compilerValidation = validateArbitraryCommandListEvidence({
            evidence: compilerEvidence,
            calls,
            context,
            revision: projectRevision,
        });
        if (compilerValidation.status === 'rejected') {
            return { actions: [], rejections: [rejection(0, '<batch>', compilerValidation.reason)] };
        }
        compilerTargetOverridesByCallIndex = compilerValidation.targetOverridesByCallIndex;
        compilerActionCommandGraph = compilerValidation.actionCommandGraph;
    }
    // These workflows expand provider calls into generated app-owned actions. Until they can rebuild an
    // action-aligned graph, compiler evidence cannot safely cross the partial-acceptance boundary.
    if (
        compilerActionCommandGraph !== undefined &&
        (workflowCapabilityId === 'shared-vocal-fx-buses' ||
            workflowCapabilityId === 'drum-render-comparison' ||
            workflowCapabilityId === 'backing-vocal-plate')
    ) {
        return {
            actions: [],
            rejections: [
                rejection(
                    0,
                    '<batch>',
                    'Compiler command graphs cannot enter application-expanded specialized workflows'
                ),
            ],
        };
    }
    if (calls.length > MAX_LLM_ACTIONS_PER_BATCH) {
        return bridgeLlmToolCalls({
            calls,
            context,
            markerSignatures,
            projectPunchRegion: createPunchRegionPatch,
            sectionSignatures,
        });
    }
    const sharedVocalFxBusesPlan = bridgeSharedVocalFxBusesPlan({
        calls,
        context,
        selected: workflowCapabilityId === 'shared-vocal-fx-buses',
    });
    if (sharedVocalFxBusesPlan.status === 'rejected') {
        return { actions: [], rejections: [rejection(0, '<batch>', sharedVocalFxBusesPlan.reason)] };
    }
    if (sharedVocalFxBusesPlan.status === 'accepted') {
        return {
            actions: sharedVocalFxBusesPlan.actions,
            batchLocalActionIdentities: sharedVocalFxBusesPlan.identities,
            rejections: [],
        };
    }
    const drumRenderComparisonPlan = bridgeDrumRenderComparisonPlan({
        calls,
        context,
        selected: workflowCapabilityId === 'drum-render-comparison',
    });
    if (drumRenderComparisonPlan.status === 'rejected') {
        return { actions: [], rejections: [rejection(0, '<batch>', drumRenderComparisonPlan.reason)] };
    }
    if (drumRenderComparisonPlan.status === 'accepted') {
        return {
            actions: drumRenderComparisonPlan.actions,
            appOwnedRenderTailSeconds: drumRenderComparisonPlan.renderTailSeconds,
            batchLocalActionIdentities: drumRenderComparisonPlan.identities,
            verifiedProviderProposalScope: drumRenderComparisonPlan.verifiedProviderProposalScope,
            rejections: [],
        };
    }
    const backingVocalPlatePlan = bridgeBackingVocalPlatePlan({
        calls,
        context,
        selected: workflowCapabilityId === 'backing-vocal-plate',
    });
    if (backingVocalPlatePlan.status === 'rejected') {
        return { actions: [], rejections: [rejection(0, '<batch>', backingVocalPlatePlan.reason)] };
    }
    if (backingVocalPlatePlan.status === 'accepted') {
        return {
            actions: backingVocalPlatePlan.actions,
            appOwnedRenderTailSeconds: backingVocalPlatePlan.renderTailSeconds,
            batchLocalActionIdentities: backingVocalPlatePlan.identities,
            rejections: [],
        };
    }
    let effectiveCalls = calls;
    const bassProcessingCopyScope =
        workflowCapabilityId === 'bass-processing-copy'
            ? getBassProcessingCopyPromptScope(context)
            : ({ status: 'none' } as const);
    const providerBassProcessingCalls = calls.filter((call) => call.name === 'addAdjustmentRegion');
    if (bassProcessingCopyScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', bassProcessingCopyScope.reason)] };
    }
    if (bassProcessingCopyScope.status === 'none' && providerBassProcessingCalls.length > 0) {
        return {
            actions: [],
            rejections: [rejection(0, '<batch>', 'Adjustment-region planning requires the exact EX-03 capability')],
        };
    }
    if (bassProcessingCopyScope.status === 'request') {
        const expectedPlan = bassProcessingCopyScope.capability.exactPlan;
        const providerPlanMatches =
            providerBassProcessingCalls.length === calls.length &&
            providerBassProcessingCalls.length === expectedPlan.length &&
            expectedPlan.every((expected) =>
                providerBassProcessingCalls.some(
                    (call) =>
                        call.arguments.layerId === expected.layerId &&
                        call.arguments.startBeat === expected.startBeat &&
                        call.arguments.endBeat === expected.endBeat &&
                        call.arguments.blend === expected.blend &&
                        call.arguments.fadeInBeats === expected.fadeInBeats &&
                        call.arguments.fadeOutBeats === expected.fadeOutBeats
                )
            ) &&
            new Set(providerBassProcessingCalls.map((call) => JSON.stringify(call.arguments))).size ===
                providerBassProcessingCalls.length;
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the complete EX-03 processing copy'),
                ],
            };
        }
        effectiveCalls = expectedPlan.flatMap((expected) => {
            const matchingCall = providerBassProcessingCalls.find(
                (call) =>
                    call.arguments.layerId === expected.layerId &&
                    call.arguments.startBeat === expected.startBeat &&
                    call.arguments.endBeat === expected.endBeat &&
                    call.arguments.blend === expected.blend &&
                    call.arguments.fadeInBeats === expected.fadeInBeats &&
                    call.arguments.fadeOutBeats === expected.fadeOutBeats
            );
            return matchingCall ? [matchingCall] : [];
        });
    }
    let sidechainRouteDeviceAdmissions: ReadonlyArray<{
        sourceTrackId: string;
        targetDeviceId: string;
        targetTrackId: string;
    }> = calls.flatMap((call, index) => {
        if (
            call.name !== 'addSidechainRoute' ||
            typeof call.arguments.sourceTrackId !== 'string' ||
            typeof call.arguments.targetTrackId !== 'string' ||
            typeof call.arguments.targetDeviceId !== 'string'
        ) {
            return [];
        }
        const overrides = compilerTargetOverridesByCallIndex?.get(index);
        const hasExactOverride = (argument: string, capability: string, stableId: string) =>
            overrides?.some(
                (override) =>
                    override.argument === argument &&
                    override.capability === capability &&
                    'stableIds' in override &&
                    override.cardinality === 'one' &&
                    override.stableIds.length === 1 &&
                    override.stableIds[0] === stableId
            ) === true;
        if (
            !hasExactOverride('sourceTrackId', 'routable-source', call.arguments.sourceTrackId) ||
            !hasExactOverride('targetTrackId', 'routable-source', call.arguments.targetTrackId) ||
            !hasExactOverride('targetDeviceId', 'sidechain-capable-device', call.arguments.targetDeviceId)
        ) {
            return [];
        }
        return [
            {
                sourceTrackId: call.arguments.sourceTrackId,
                targetTrackId: call.arguments.targetTrackId,
                targetDeviceId: call.arguments.targetDeviceId,
            },
        ];
    });
    const articulationTransferScope =
        workflowCapabilityId === 'articulation-transfer'
            ? getArticulationTransferPromptScope(context)
            : ({ status: 'none' } as const);
    if (articulationTransferScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', articulationTransferScope.reason)] };
    }
    if (articulationTransferScope.status === 'request') {
        const providerTransfers = calls.filter((call) => call.name === 'copyMidiArticulations');
        const providerKeys = providerTransfers.flatMap((call) => {
            const { sourceClipId, targetClipId } = call.arguments;
            return typeof sourceClipId === 'string' && typeof targetClipId === 'string'
                ? [`${sourceClipId}\u0000${targetClipId}`]
                : [];
        });
        const exactKeys = articulationTransferScope.clipPairs.map(
            (pair) => `${pair.sourceClipId}\u0000${pair.targetClipId}`
        );
        const providerKeySet = new Set(providerKeys);
        const providerPlanMatches =
            providerTransfers.length === calls.length &&
            providerKeys.length === calls.length &&
            providerKeySet.size === providerKeys.length &&
            providerKeys.length === exactKeys.length &&
            exactKeys.every((key) => providerKeySet.has(key));
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [
                    rejection(
                        0,
                        '<batch>',
                        'Provider plan does not match the complete MF-03 articulation clip-pair set'
                    ),
                ],
            };
        }
        effectiveCalls = articulationTransferScope.clipPairs.flatMap((pair) => {
            const providerTransfer = providerTransfers.find(
                (call) =>
                    call.arguments.sourceClipId === pair.sourceClipId &&
                    call.arguments.targetClipId === pair.targetClipId
            );
            return providerTransfer ? [providerTransfer] : [];
        });
    }
    const midiOverlapTransformScope =
        workflowCapabilityId === 'midi-overlap-shortening'
            ? getMidiOverlapTransformPromptScope(context)
            : ({ status: 'none' } as const);
    if (midiOverlapTransformScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', midiOverlapTransformScope.reason)] };
    }
    if (midiOverlapTransformScope.status === 'request') {
        const providerTransforms = calls.filter((call) => call.name === 'removeShortMidiOverlaps');
        const providerClipIds = providerTransforms.flatMap((call) =>
            typeof call.arguments.clipId === 'string' ? [call.arguments.clipId] : []
        );
        const providerClipIdSet = new Set(providerClipIds);
        const expectedClipIds = midiOverlapTransformScope.entries.map(({ clipId }) => clipId);
        const providerPlanMatches =
            providerTransforms.length === calls.length &&
            providerClipIds.length === calls.length &&
            providerClipIdSet.size === providerClipIds.length &&
            providerClipIds.length === expectedClipIds.length &&
            expectedClipIds.every((clipId) => providerClipIdSet.has(clipId)) &&
            providerTransforms.every(
                (call) => call.arguments.maximumOverlapMs === midiOverlapTransformScope.maximumOverlapMs
            );
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the complete EX-04 selected MIDI clip set'),
                ],
            };
        }
        effectiveCalls = expectedClipIds.flatMap((clipId) => {
            const providerTransform = providerTransforms.find((call) => call.arguments.clipId === clipId);
            return providerTransform ? [providerTransform] : [];
        });
    }
    const syncopatedArpeggioScope =
        workflowCapabilityId === 'syncopated-arpeggio'
            ? getSyncopatedArpeggioPromptScope(context)
            : ({ status: 'none' } as const);
    const providerArpeggioCalls = calls.filter((call) => call.name === 'arpeggiate');
    if (syncopatedArpeggioScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', syncopatedArpeggioScope.reason)] };
    }
    if (syncopatedArpeggioScope.status === 'none' && providerArpeggioCalls.length > 0) {
        return {
            actions: [],
            rejections: [rejection(0, '<batch>', 'Arpeggio planning requires the exact EX-07 capability')],
        };
    }
    if (syncopatedArpeggioScope.status === 'request') {
        const providerAction = providerArpeggioCalls[0];
        const providerPlanMatches =
            calls.length === 1 &&
            providerArpeggioCalls.length === 1 &&
            providerAction !== undefined &&
            providerAction.arguments.clipId === syncopatedArpeggioScope.clipId &&
            providerAction.arguments.pattern === 'up' &&
            providerAction.arguments.rate === 8 &&
            providerAction.arguments.octaves === 1 &&
            providerAction.arguments.gate === 50;
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [rejection(0, '<batch>', 'Provider plan does not match the exact EX-07 arpeggio scope')],
            };
        }
        effectiveCalls = [providerAction];
    }
    const drumPreviewBranchesScope =
        workflowCapabilityId === 'drum-preview-branches'
            ? getDrumPreviewBranchesPromptScope(context)
            : ({ status: 'none' } as const);
    if (drumPreviewBranchesScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', drumPreviewBranchesScope.reason)] };
    }
    if (drumPreviewBranchesScope.status === 'request') {
        const providerActions = calls.filter((call) => call.name === 'createDrumPreviewBranches');
        const providerAction = providerActions[0];
        if (!providerAction) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the complete EX-05 preview-branch request'),
                ],
            };
        }
        const varyingRoles = providerAction.arguments.varyingRoles;
        const providerPlanMatches =
            calls.length === 1 &&
            providerActions.length === 1 &&
            providerAction.arguments.sectionId === drumPreviewBranchesScope.section.id &&
            providerAction.arguments.candidateCount === 3 &&
            Array.isArray(varyingRoles) &&
            varyingRoles.length === 2 &&
            varyingRoles[0] === 'snare' &&
            varyingRoles[1] === 'hi-hat';
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the complete EX-05 preview-branch request'),
                ],
            };
        }
        effectiveCalls = [providerAction];
    }
    const drumRoutingScope =
        workflowCapabilityId === 'drum-routing' ? getDrumRoutingPromptScope(context) : ({ status: 'none' } as const);
    if (drumRoutingScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', drumRoutingScope.reason)] };
    }
    if (drumRoutingScope.status === 'request') {
        const providerRoutes = calls.filter((call) => call.name === 'setTrackOutput');
        const providerTrackIds = providerRoutes.flatMap((call) =>
            typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : []
        );
        const providerTrackIdSet = new Set(providerTrackIds);
        const targetIdSet = new Set(drumRoutingScope.targetIds);
        const providerPlanMatches =
            providerRoutes.length === calls.length &&
            providerTrackIds.length === calls.length &&
            providerTrackIdSet.size === providerTrackIds.length &&
            providerTrackIds.length === drumRoutingScope.targetIds.length &&
            drumRoutingScope.targetIds.every((trackId) => providerTrackIdSet.has(trackId)) &&
            providerRoutes.every((call) => call.arguments.outputId === drumRoutingScope.busId);
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [rejection(0, '<batch>', 'Provider plan does not match the complete MF-01 drum route set')],
            };
        }
        effectiveCalls = drumRoutingScope.targetIds.flatMap((trackId) => {
            const route = providerRoutes.find((call) => call.arguments.trackId === trackId);
            return route ? [route] : [];
        });
        if (targetIdSet.has(drumRoutingScope.protectedReturnId)) {
            return {
                actions: [],
                rejections: [rejection(0, '<batch>', 'MF-01 protected return cannot enter the route target set')],
            };
        }
    }
    const sidechainRoutingScope = getSidechainRoutingPromptScope(prompt, context);
    if (sidechainRoutingScope.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', sidechainRoutingScope.reason)] };
    }
    if (sidechainRoutingScope.status === 'request') {
        sidechainRouteDeviceAdmissions = [...sidechainRouteDeviceAdmissions, ...sidechainRoutingScope.routes];
        const providerRoutes = calls.filter((call) => call.name === 'addSidechainRoute');
        const providerRouteKeys = providerRoutes.flatMap((call) => {
            const { sourceTrackId, targetTrackId, targetDeviceId } = call.arguments;
            return typeof sourceTrackId === 'string' &&
                typeof targetTrackId === 'string' &&
                typeof targetDeviceId === 'string'
                ? [`${sourceTrackId}\u0000${targetTrackId}\u0000${targetDeviceId}`]
                : [];
        });
        const exactRouteKeys = sidechainRoutingScope.routes.map(
            (route) => `${route.sourceTrackId}\u0000${route.targetTrackId}\u0000${route.targetDeviceId}`
        );
        const providerRouteKeySet = new Set(providerRouteKeys);
        const providerPlanMatches =
            providerRoutes.length === calls.length &&
            providerRouteKeys.length === calls.length &&
            providerRouteKeySet.size === providerRouteKeys.length &&
            providerRouteKeys.length === exactRouteKeys.length &&
            exactRouteKeys.every((key) => providerRouteKeySet.has(key));
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the complete MF-06 sidechain route set'),
                ],
            };
        }
        effectiveCalls = sidechainRoutingScope.routes.flatMap((route) => {
            const providerRoute = providerRoutes.find(
                (call) =>
                    call.arguments.sourceTrackId === route.sourceTrackId &&
                    call.arguments.targetTrackId === route.targetTrackId &&
                    call.arguments.targetDeviceId === route.targetDeviceId
            );
            return providerRoute ? [providerRoute] : [];
        });
    }
    const wholeProjectVibeMixScope = getWholeProjectVibeMixScope(prompt, context);
    const providerVibeMixCalls = calls.filter((call) => call.name === 'automateTrackGainRange');
    if (wholeProjectVibeMixScope || providerVibeMixCalls.length > 0) {
        const providerCall = providerVibeMixCalls[0];
        const assertedTrackIds = providerCall?.arguments.trackIds;
        if (!wholeProjectVibeMixScope || !providerCall) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the bounded whole-project vibe-mix scope'),
                ],
            };
        }
        const matchesScope =
            calls.length === 1 &&
            providerVibeMixCalls.length === 1 &&
            hasExactTargetIdSet(assertedTrackIds, wholeProjectVibeMixScope.targetIds) &&
            providerCall.arguments.sectionName === wholeProjectVibeMixScope.section.name &&
            providerCall.arguments.gainDb === wholeProjectVibeMixScope.plan.dynamicTrajectory.gainDb;
        if (!matchesScope) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the bounded whole-project vibe-mix scope'),
                ],
            };
        }
        effectiveCalls = [
            {
                ...providerCall,
                arguments: {
                    trackIds: wholeProjectVibeMixScope.targetIds,
                    sectionName: wholeProjectVibeMixScope.section.name,
                    gainDb: wholeProjectVibeMixScope.plan.dynamicTrajectory.gainDb,
                },
            },
        ];
    }
    const mutedEmptyDeletionScope = getMutedEmptyTrackDeletionScope(prompt, context);
    if (mutedEmptyDeletionScope) {
        const providerTrackIds = calls.flatMap((call) =>
            call.name === 'removeTrack' && typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : []
        );
        const providerTrackIdSet = new Set(providerTrackIds);
        const providerPlanMatches =
            providerTrackIds.length === calls.length &&
            providerTrackIdSet.size === providerTrackIds.length &&
            providerTrackIds.length === mutedEmptyDeletionScope.targetIds.length &&
            mutedEmptyDeletionScope.targetIds.every((trackId) => providerTrackIdSet.has(trackId));
        if (!providerPlanMatches) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider plan does not match the complete muted empty track set'),
                ],
            };
        }
    }
    const glueAnalysis = analyzeGluePrompt(prompt, context);
    const providerGlueCalls = calls.filter((call) => call.name === 'glueClips');
    if (glueAnalysis.status === 'invalid') {
        return { actions: [], rejections: [rejection(0, '<batch>', invalidGlueRequestReason)] };
    }
    if (glueAnalysis.status === 'none' && providerGlueCalls.length > 0) {
        return { actions: [], rejections: [rejection(0, '<batch>', mismatchedGluePlanReason)] };
    }
    if (glueAnalysis.status === 'request') {
        const providerGlueCall = providerGlueCalls[0];
        const hasMatchingProviderCall =
            providerGlueCalls.length === 1 &&
            providerGlueCall !== undefined &&
            hasExactGlueClipPair(providerGlueCall.arguments.clipIds, glueAnalysis.clipIds);
        const providerPlanMatches = glueAnalysis.cancelled
            ? providerGlueCalls.length === 0 || hasMatchingProviderCall
            : hasMatchingProviderCall;
        if (!providerPlanMatches) {
            return { actions: [], rejections: [rejection(0, '<batch>', mismatchedGluePlanReason)] };
        }
        if (glueAnalysis.cancelled) {
            effectiveCalls = calls.filter((call) => call.name !== 'glueClips');
        }
    }
    const catalog = getExecutableAppActionGroundingCatalog();
    const promptActionAnalysis = analyzePromptActionRequests(prompt, catalog);
    const promptActionRequests = promptActionAnalysis.requests;
    const activePromptActionRequests = promptActionRequests.filter((request) => !request.cancelled);
    const totalPunchPromptRequests = promptActionRequests.filter((request) => isPunchActionType(request.actionType));
    const punchPromptRequests = activePromptActionRequests.filter((request) => isPunchActionType(request.actionType));
    const punchProviderCalls = effectiveCalls.filter((call) => isPunchActionType(call.name));
    if (punchPromptRequests.length > 0 || punchProviderCalls.length > 0) {
        const promptRequest = punchPromptRequests[0];
        const providerCall = punchProviderCalls[0];
        const isExactSingleton =
            totalPunchPromptRequests.length === 1 &&
            punchPromptRequests.length === 1 &&
            punchProviderCalls.length === 1 &&
            effectiveCalls.length === 1 &&
            activePromptActionRequests.length === 1 &&
            promptRequest !== undefined &&
            isExactPunchActionCommandClause(promptRequest) &&
            isPunchPromptFullyCovered(promptActionAnalysis) &&
            !hasMalformedPunchNumericContinuation(maskQuotedLabels(prompt)) &&
            providerCall?.name === promptRequest.actionType;
        if (!isExactSingleton) {
            return {
                actions: [],
                rejections: [rejection(0, '<batch>', 'Punch request must name exactly one direct command')],
            };
        }
    }
    const totalClipLoopLengthPromptRequests = promptActionRequests.filter(
        (request) => request.actionType === 'setClipLoopLength'
    );
    const clipLoopLengthPromptRequests = activePromptActionRequests.filter(
        (request) => request.actionType === 'setClipLoopLength'
    );
    const clipLoopLengthProviderCalls = effectiveCalls.filter((call) => call.name === 'setClipLoopLength');
    const hasOnlyCancelledClipLoopLengthRequests =
        totalClipLoopLengthPromptRequests.length > 0 && clipLoopLengthPromptRequests.length === 0;
    if (
        !hasOnlyCancelledClipLoopLengthRequests &&
        (clipLoopLengthPromptRequests.length > 0 || clipLoopLengthProviderCalls.length > 0)
    ) {
        const promptRequest = clipLoopLengthPromptRequests[0];
        const providerCall = clipLoopLengthProviderCalls[0];
        const isExactSingleton =
            totalClipLoopLengthPromptRequests.length === 1 &&
            clipLoopLengthPromptRequests.length === 1 &&
            clipLoopLengthProviderCalls.length === 1 &&
            effectiveCalls.length === 1 &&
            activePromptActionRequests.length === 1 &&
            promptRequest !== undefined &&
            isExactClipLoopLengthCommandClause(promptRequest) &&
            isClipLoopLengthPromptFullyCovered(promptActionAnalysis) &&
            providerCall?.name === promptRequest.actionType;
        if (!isExactSingleton) {
            return {
                actions: [],
                rejections: [rejection(0, '<batch>', 'Clip loop-length request must name exactly one direct command')],
            };
        }
    }
    const promptRequestsLoopRegion = hasExplicitPromptIntent(prompt, catalog, 'setLoopRegion');
    const promptRequestsLoopEnabled = hasExplicitPromptIntent(prompt, catalog, 'setLoopEnabled');
    const requiresCompoundLoop = promptRequestsLoopRegion && promptRequestsLoopEnabled;
    if (requiresCompoundLoop) {
        const hasLoopRegionCall = effectiveCalls.some((call) => call.name === 'setLoopRegion');
        const hasLoopEnabledCall = effectiveCalls.some((call) => call.name === 'setLoopEnabled');
        if (!hasLoopRegionCall || !hasLoopEnabledCall) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider omitted an explicit loop command from the compound request'),
                ],
            };
        }
    }
    if (
        compilerActionCommandGraph !== undefined &&
        (compilerEvidence === undefined ||
            compilerTargetOverridesByCallIndex === undefined ||
            !hasExactCanonicalToolCallOrder(compilerEvidence.commands, effectiveCalls))
    ) {
        return {
            actions: [],
            rejections: [
                rejection(
                    0,
                    '<batch>',
                    'Compiler evidence indexes no longer match the specialized workflow command order'
                ),
            ],
        };
    }
    const collectedBindings = collectBatchLocalBusBindings(effectiveCalls, context);
    if (collectedBindings.status === 'rejected') {
        return {
            actions: [],
            rejections: [collectedBindings.rejection],
        };
    }
    const groundingRejections = new Map<number, LlmActionRejection>();
    const groundedCalls: ToolCallResult[] = [];
    const acceptedGroundedCalls: ToolCallResult[] = [];
    const visibleBindings = new Map<string, BatchLocalBusBinding>();
    const visiblePlannedTrackCreations: ToolCallResult[] = [];
    let prospectiveContext = context;
    for (const [index, providerCall] of effectiveCalls.entries()) {
        const call = stripBatchLocalBinding(providerCall);
        const actionOrdinal = effectiveCalls.slice(0, index).filter((candidate) => candidate.name === call.name).length;
        const sameActionCalls = effectiveCalls.filter((candidate) => candidate.name === call.name);
        const sameActionCallCount = sameActionCalls.length;
        let grounded: ToolCallResult | LlmActionRejection;
        if (
            (bassProcessingCopyScope.status === 'request' && call.name === 'addAdjustmentRegion') ||
            (midiOverlapTransformScope.status === 'request' && call.name === 'removeShortMidiOverlaps') ||
            (syncopatedArpeggioScope.status === 'request' && call.name === 'arpeggiate') ||
            (drumPreviewBranchesScope.status === 'request' && call.name === 'createDrumPreviewBranches')
        ) {
            grounded = call;
        } else {
            grounded = groundToolCall({
                actionOrdinal,
                batchLocalBusBindings: visibleBindings,
                call,
                catalog,
                context: prospectiveContext,
                declaredBatchLocalBusBindings: collectedBindings.bindingsByName,
                index,
                prompt,
                plannedActionNames: effectiveCalls.map((candidate) => candidate.name),
                sameActionAssertedArguments: sameActionCalls.map((candidate) => candidate.arguments),
                sameActionCallCount,
                resolvedTargetOverrides: compilerTargetOverridesByCallIndex?.get(index),
                visibleGroundedCalls: acceptedGroundedCalls,
                visiblePlannedTrackCreations,
                workflowCapabilityId,
            });
        }
        if ('reason' in grounded) {
            groundingRejections.set(index, grounded);
            groundedCalls.push({ name: '<rejected-target-reference>', arguments: {} });
            continue;
        }
        groundedCalls.push(grounded);
        acceptedGroundedCalls.push(grounded);
        if (grounded.name === 'createBus' || grounded.name === 'addTrack') {
            visiblePlannedTrackCreations.push(grounded);
        }
        const binding = collectedBindings.bindingsByCallIndex.get(index);
        if (binding) {
            visibleBindings.set(binding.binding, binding);
            prospectiveContext = {
                ...prospectiveContext,
                tracks: [...prospectiveContext.tracks, createProjectedBus(prospectiveContext, binding)],
            };
        }
    }
    let bridged = bridgeLlmToolCalls({
        calls: groundedCalls,
        context: prospectiveContext,
        markerSignatures,
        projectPunchRegion: createPunchRegionPatch,
        sectionSignatures,
        sidechainRouteDeviceAdmissions,
    });
    if (mutedEmptyDeletionScope) {
        const targetIds = new Set(mutedEmptyDeletionScope.targetIds);
        bridged = {
            ...bridged,
            actions: bridged.actions.map((action) => {
                if (action.type !== 'removeTrack' || !targetIds.has(action.payload.trackId)) {
                    return action;
                }
                const target = context.tracks.find((track) => track.id === action.payload.trackId);
                if (!target || (target.kind !== 'audio' && target.kind !== 'midi')) {
                    return action;
                }
                return {
                    ...action,
                    payload: {
                        ...action.payload,
                        expectedKind: target.kind,
                        expectedMuted: target.muted,
                        expectedClipIds: target.clips.map((clip) => clip.id),
                        expectedAlternativeClipIds: target.alternativeClipIds,
                        expectedVcaGroupId: target.vcaGroupId ?? null,
                        expectedVcaMembershipGroupIds: (context.vcaGroups ?? [])
                            .filter((group) => group.trackIds.includes(target.id))
                            .map((group) => group.id)
                            .sort(),
                    },
                };
            }),
        };
    }
    const rejections = bridged.rejections.map((bridgeRejection) => {
        if (bridgeRejection.name === '<batch>') {
            return bridgeRejection;
        }
        return groundingRejections.get(bridgeRejection.index) ?? bridgeRejection;
    });
    if (
        compilerActionCommandGraph !== undefined &&
        rejections.length === 0 &&
        (bridged.actions.length !== compilerActionCommandGraph.dependenciesByActionIndex.length ||
            bridged.actions.some((action, index) => action.type !== effectiveCalls[index]?.name))
    ) {
        return {
            actions: [],
            rejections: [rejection(0, '<batch>', 'Compiler action graph no longer matches the bridged command batch')],
        };
    }
    if (rejections.some((bridgeRejection) => bridgeRejection.name === 'glueClips')) {
        return { actions: [], rejections: [rejection(0, '<batch>', invalidGlueRequestReason)] };
    }
    const usesBatchLocalReferences = effectiveCalls.some((call) =>
        Object.values(call.arguments).some((value) => typeof value === 'string' && value.startsWith('$'))
    );
    if (rejections.length > 0 && (usesBatchLocalReferences || collectedBindings.bindingsByName.size > 0)) {
        return { actions: [], rejections };
    }
    const hasGroundedLoopRegion = bridged.actions.some((action) => action.type === 'setLoopRegion');
    const hasGroundedLoopEnabled = bridged.actions.some((action) => action.type === 'setLoopEnabled');
    if (requiresCompoundLoop && (!hasGroundedLoopRegion || !hasGroundedLoopEnabled)) {
        if (rejections.length === 0) {
            rejections.push(rejection(0, '<batch>', 'Provider failed to ground the complete compound loop request'));
        }
        return { actions: [], rejections };
    }
    if (rejections.length > 0 || collectedBindings.bindingsByName.size === 0) {
        return {
            actions: bridged.actions,
            ...(bassProcessingCopyScope.status === 'request' ? { bassProcessingCopyScope } : {}),
            ...(midiOverlapTransformScope.status === 'request' ? { midiOverlapTransformScope } : {}),
            ...(drumPreviewBranchesScope.status === 'request' ? { drumPreviewBranchesScope } : {}),
            ...(syncopatedArpeggioScope.status === 'request' ? { syncopatedArpeggioScope } : {}),
            ...(rejections.length === 0 && compilerActionCommandGraph !== undefined
                ? { actionCommandGraph: compilerActionCommandGraph }
                : {}),
            rejections,
        };
    }
    const batchLocalActionIdentities = [...collectedBindings.bindingsByName.values()].map(
        ({ actionOrdinal, actionType, busId }) => ({ actionOrdinal, actionType, busId })
    );
    return {
        actions: bridged.actions,
        ...(bassProcessingCopyScope.status === 'request' ? { bassProcessingCopyScope } : {}),
        ...(midiOverlapTransformScope.status === 'request' ? { midiOverlapTransformScope } : {}),
        ...(drumPreviewBranchesScope.status === 'request' ? { drumPreviewBranchesScope } : {}),
        ...(syncopatedArpeggioScope.status === 'request' ? { syncopatedArpeggioScope } : {}),
        batchLocalActionIdentities,
        ...(compilerActionCommandGraph === undefined ? {} : { actionCommandGraph: compilerActionCommandGraph }),
        rejections,
    };
}
