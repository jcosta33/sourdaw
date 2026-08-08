import {
    getExecutableAppActionGroundingCatalog,
    getExecutableAppActionGroundingRules,
} from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
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

import { resolveAgentReference } from './resolveAgentReference';

type BridgeGroundedLlmToolCallsInput = {
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    markerSignatures?: readonly MarkerPlanningSignature[];
    sectionSignatures?: readonly SectionPlanningSignature[];
    prompt: string;
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
    visibleGroundedCalls: readonly ToolCallResult[];
    visiblePlannedTrackCreations: readonly ToolCallResult[];
};

type PromptClause = {
    masked: string;
    text: string;
};

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;
type GroundingRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>;

export type BatchLocalActionIdentity = {
    actionOrdinal: number;
    actionType: 'createBus';
    busId: string;
};

type BridgeGroundedLlmToolCallsResult = LlmActionBridgeResult & {
    batchLocalActionIdentities?: BatchLocalActionIdentity[];
};

type BatchLocalBusBinding = BatchLocalActionIdentity & {
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

type ActionPromptScope = PromptClause & {
    directional: boolean;
    matchedIntentPhrase: string;
};

type ResolveActionPromptScopeInput = {
    actionName: string;
    actionOrdinal: number;
    assertedArguments: Readonly<Record<string, unknown>>;
    catalog: GroundingCatalog;
    context: ProjectContext;
    prompt: string;
    plannedActionNames: readonly string[];
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[];
    sameActionCallCount: number;
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
            const assertedId = assertedArguments[targetRule.argument];
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
    return { direct: [...direct], owners: [...owners] };
}

function resolveActionPromptScope({
    actionName,
    actionOrdinal,
    assertedArguments,
    catalog,
    context,
    prompt,
    plannedActionNames,
    sameActionAssertedArguments,
    sameActionCallCount,
}: ResolveActionPromptScopeInput): ActionPromptScope | null {
    const groundingRules = getExecutableAppActionGroundingRules(actionName);
    if (
        !groundingRules ||
        hasTrailingIntentCancellation(prompt, actionName, catalog, plannedActionNames) ||
        (actionName === 'setClipFade' && hasInvalidNamedClipFadeField(prompt))
    ) {
        return null;
    }
    const projectMaskedPrompt =
        groundingRules.targetRules.length === 0 ? prompt : maskProjectReferences(prompt, context);
    const maskedPrompt = maskQuotedLabels(projectMaskedPrompt);
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
    if (matchingScopes.length !== sameActionCallCount) {
        return null;
    }
    const selectedScope = matchingScopes[actionOrdinal];
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
    return /\bfit(?: the)? clip(?: duration)? to$/u.test(prefix);
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
            const expectedValue = getSectionNameFromPrompt(actionScope.text);
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
    prompt,
}: {
    assertedIds: unknown;
    capability: GroundingRules['targetRules'][number]['capability'];
    context: ProjectContext;
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
    if (capability !== 'vca-member-track') {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }

    const candidates = context.tracks.filter(
        (track) => track.kind === 'audio' || track.kind === 'midi' || track.kind === 'bus' || track.kind === 'folder'
    );
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
    sameActionAssertedArguments,
    sameActionCallCount,
    visibleGroundedCalls,
    visiblePlannedTrackCreations,
}: GroundToolCallInput): ToolCallResult | LlmActionRejection {
    if (call.name === 'stopPlayback' && !isExplicitStopPlaybackPrompt(prompt)) {
        return rejection(index, call.name, 'Provider action is not grounded in an explicit transport-stop request');
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
        context,
        prompt,
        plannedActionNames,
        sameActionAssertedArguments,
        sameActionCallCount,
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
    for (const targetRule of groundingRules.targetRules) {
        const assertedValue = groundedArguments[targetRule.argument];
        const targetPrompt = getTargetPromptScope(actionScope, targetRule.promptRole);
        if (targetRule.cardinality === 'many') {
            const result = resolveAgentReferenceArray({
                assertedIds: assertedValue,
                capability: targetRule.capability,
                context,
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
        const result = resolveAgentReference({
            prompt: targetPrompt,
            assertedId: assertedValue,
            capability: targetRule.capability,
            context,
            dependencyId: typeof dependencyValue === 'string' ? dependencyValue : undefined,
            excludedIds: typeof distinctValue === 'string' ? [distinctValue] : [],
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

export function bridgeGroundedLlmToolCalls({
    calls,
    context,
    markerSignatures = [],
    sectionSignatures = [],
    prompt,
}: BridgeGroundedLlmToolCallsInput): BridgeGroundedLlmToolCallsResult {
    if (calls.length > MAX_LLM_ACTIONS_PER_BATCH) {
        return bridgeLlmToolCalls({ calls, context, markerSignatures, sectionSignatures });
    }
    const catalog = getExecutableAppActionGroundingCatalog();
    const promptRequestsLoopRegion = hasExplicitPromptIntent(prompt, catalog, 'setLoopRegion');
    const promptRequestsLoopEnabled = hasExplicitPromptIntent(prompt, catalog, 'setLoopEnabled');
    const requiresCompoundLoop = promptRequestsLoopRegion && promptRequestsLoopEnabled;
    if (requiresCompoundLoop) {
        const hasLoopRegionCall = calls.some((call) => call.name === 'setLoopRegion');
        const hasLoopEnabledCall = calls.some((call) => call.name === 'setLoopEnabled');
        if (!hasLoopRegionCall || !hasLoopEnabledCall) {
            return {
                actions: [],
                rejections: [
                    rejection(0, '<batch>', 'Provider omitted an explicit loop command from the compound request'),
                ],
            };
        }
    }
    const collectedBindings = collectBatchLocalBusBindings(calls, context);
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
    for (const [index, providerCall] of calls.entries()) {
        const call = stripBatchLocalBinding(providerCall);
        const actionOrdinal = calls.slice(0, index).filter((candidate) => candidate.name === call.name).length;
        const sameActionCalls = calls.filter((candidate) => candidate.name === call.name);
        const sameActionCallCount = sameActionCalls.length;
        const grounded = groundToolCall({
            actionOrdinal,
            batchLocalBusBindings: visibleBindings,
            call,
            catalog,
            context: prospectiveContext,
            declaredBatchLocalBusBindings: collectedBindings.bindingsByName,
            index,
            prompt,
            plannedActionNames: calls.map((candidate) => candidate.name),
            sameActionAssertedArguments: sameActionCalls.map((candidate) => candidate.arguments),
            sameActionCallCount,
            visibleGroundedCalls: acceptedGroundedCalls,
            visiblePlannedTrackCreations,
        });
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
    const bridged = bridgeLlmToolCalls({
        calls: groundedCalls,
        context: prospectiveContext,
        markerSignatures,
        sectionSignatures,
    });
    const rejections = bridged.rejections.map((bridgeRejection) => {
        if (bridgeRejection.name === '<batch>') {
            return bridgeRejection;
        }
        return groundingRejections.get(bridgeRejection.index) ?? bridgeRejection;
    });
    const usesBatchLocalReferences = calls.some((call) =>
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
        return { actions: bridged.actions, rejections };
    }
    const batchLocalActionIdentities = [...collectedBindings.bindingsByName.values()].map(
        ({ actionOrdinal, actionType, busId }) => ({ actionOrdinal, actionType, busId })
    );
    return { actions: bridged.actions, batchLocalActionIdentities, rejections };
}
