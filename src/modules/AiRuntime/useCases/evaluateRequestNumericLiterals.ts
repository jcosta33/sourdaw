import { trackStore } from '#/modules/Arrangement/stores';
import { type parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type MetricGoalEvaluation, type MetricNativeLiteralUse } from '../models/MetricGoalAdmission';

import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { getPromptClauses } from './agentReference/groundingStrategies/getPromptClauses';
import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';
import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from './metricGoalContractTypes';
import { readNativeLiteralCommandBinding } from './readNativeLiteralCommandBinding';
import { readRequestMetricNumbers, type RequestMetricNumber } from './readRequestMetricNumbers';

type Envelope = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];
type Failure = NonNullable<MetricGoalEvaluation['failure']>;
type Refusal = { failure: Failure; reason: string };

function coversToken(request: string, name: string, candidate: RequestMetricNumber): boolean {
    if (name.length === 0 || !name.toLowerCase().includes(candidate.token.toLowerCase())) {
        return false;
    }
    for (const match of request.matchAll(new RegExp(escapeRegExp(name), 'giu'))) {
        if (
            candidate.start >= match.index &&
            candidate.start + candidate.token.length <= match.index + match[0].length
        ) {
            return true;
        }
    }
    return false;
}

function numericLiteralWitness(
    candidate: RequestMetricNumber,
    request: string,
    envelope: Envelope,
    usedArguments: Set<string>
): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const namedObjects = tracks.flatMap((track) => [
        { id: track.id, name: track.name },
        ...track.clips.map((clip) => ({ id: clip.id, name: clip.name })),
        ...track.devices.map((device) => ({ id: device.id, name: device.name ?? '' })),
    ]);
    for (const command of envelope.commands) {
        const referencedIds = new Set(command.objectReferences.map((reference) => reference.id));
        if (
            namedObjects.some((object) => referencedIds.has(object.id) && coversToken(request, object.name, candidate))
        ) {
            return true;
        }
        const newName = command.arguments.name;
        if (typeof newName === 'string' && coversToken(request, newName, candidate)) {
            return true;
        }
        const clause = getPromptClauses(request, request).find(
            (entry) => candidate.start >= entry.start && candidate.start < entry.end
        );
        const names = tracks.flatMap((track) => {
            if (
                referencedIds.has(track.id) ||
                track.devices.some((device) => referencedIds.has(device.id)) ||
                track.clips.some((clip) => referencedIds.has(clip.id))
            ) {
                return [
                    track.name,
                    ...namedObjects.filter((object) => referencedIds.has(object.id)).map((object) => object.name),
                ];
            }
            return [];
        });
        if (clause === undefined) {
            continue;
        }
        const normalizedClause = ` ${normalizeAgentReferenceText(clause.text)} `;
        const namedTarget = names.some((name) => {
            const normalizedName = normalizeAgentReferenceText(name);
            return normalizedName.length > 0 && normalizedClause.includes(` ${normalizedName} `);
        });
        if (!namedTarget) {
            continue;
        }
        const argumentKey = `${command.commandId}:${candidate.unit}`;
        if (usedArguments.has(argumentKey)) {
            continue;
        }
        if (
            candidate.unit === 'LUFS' &&
            command.operation === 'normalizeClip' &&
            command.arguments.mode === 'lufs' &&
            command.arguments.targetDb === candidate.value
        ) {
            usedArguments.add(argumentKey);
            return true;
        }
        if (
            candidate.unit === 'Hz' &&
            command.operation === 'setDeviceParameter' &&
            command.arguments.value === candidate.value &&
            command.parameterUnits.some((entry) => entry.argument === 'value' && entry.unit === 'Hz')
        ) {
            usedArguments.add(argumentKey);
            return true;
        }
    }
    return false;
}

/**
 * Every figure a request chain stated is accounted against the text that stated it: a refinement
 * inherits its earlier requests' figures, which only the refined batch or a goal they selected can
 * account for. A later request stating a figure in the same unit replaces them, and its own figure
 * is accounted in their place.
 */
export function unaccountedNumericRefusal(state: MetricGoalState, envelope: Envelope): Refusal | null {
    const nativeRefusal = nativeLiteralUseRefusal(state, envelope);
    if (nativeRefusal !== null) {
        return nativeRefusal;
    }
    const inherited = state.refinedRequests ?? [];
    const texts = [...inherited, envelope.intent];
    const statedRequests = [
        ...inherited.map((request, index) => ({
            request,
            goals: goalsSelectedFor(state, request),
            superseded: supersededUnits(texts.slice(index + 1)),
        })),
        {
            request: envelope.intent,
            goals: state.authorities.flatMap((authority) => authority.goals),
            superseded: new Set<RequestMetricNumber['unit']>(),
        },
    ];
    for (const { request, goals, superseded } of statedRequests) {
        const refusal = unaccountedRequestNumber(request, goals, superseded, state, envelope);
        if (refusal !== null) {
            return refusal;
        }
    }
    return null;
}

function supersededUnits(laterTexts: readonly string[]): Set<RequestMetricNumber['unit']> {
    return new Set(laterTexts.flatMap((text) => readRequestMetricNumbers(text).map((candidate) => candidate.unit)));
}

function goalsSelectedFor(state: MetricGoalState, request: string): MetricGoal[] {
    const requestDigest = digest(request.trim());
    return state.authorities
        .filter((authority) => authority.requestDigest === requestDigest)
        .flatMap((authority) => authority.goals);
}

function unaccountedRequestNumber(
    request: string,
    selected: readonly MetricGoal[],
    superseded: ReadonlySet<RequestMetricNumber['unit']>,
    state: MetricGoalState,
    envelope: Envelope
): Refusal | null {
    const usedArguments = new Set<string>();
    const stated = readRequestMetricNumbers(request).filter((candidate) => !superseded.has(candidate.unit));
    for (const candidate of stated) {
        const selectedGoal = selected.find(
            (goal) =>
                goal.source.kind === 'request-number' &&
                goal.source.candidateId === candidate.candidateId &&
                goal.source.token === candidate.token &&
                goal.metricId === candidate.metricId &&
                goal.targetValue === candidate.value &&
                goal.relation === 'target' &&
                goal.tolerance === 0
        );
        if (
            selectedGoal === undefined &&
            !workflowNativeLiteralWitness(candidate, request, state, usedArguments) &&
            !numericLiteralWitness(candidate, request, envelope, usedArguments)
        ) {
            return {
                failure: 'missing',
                reason: `The request's ${candidate.token} candidate has no selected metric goal or grounded literal use.`,
            };
        }
    }
    return null;
}

function nativeLiteralUseRefusal(state: MetricGoalState, envelope: Envelope): Refusal | null {
    const numbers = readRequestMetricNumbers(envelope.intent);
    const seen = new Set<string>();
    for (const use of state.nativeLiteralUses ?? []) {
        const authority = state.authorities.find((entry) => entry.authorityId === use.authorityId);
        const matches = numbers.filter((candidate) => candidate.value === use.value && candidate.unit === use.unit);
        const binding = readNativeLiteralCommandBinding(use, envelope, state.binding?.schedulePosition ?? null);
        const argument = `${use.binding?.commandId}:${use.unit}`;
        if (
            !nativeLiteralAuthorityMatches(use, authority, envelope) ||
            !nativeLiteralCandidateMatches(use, matches) ||
            use.binding === null ||
            binding === null ||
            JSON.stringify(binding) !== JSON.stringify(use.binding) ||
            seen.has(use.candidateId) ||
            seen.has(argument)
        ) {
            return {
                failure: 'stale',
                reason: 'Native literal accounting no longer matches its admitted request, created owner, parameter or Command batch.',
            };
        }
        seen.add(use.candidateId);
        seen.add(argument);
    }
    return null;
}

function nativeLiteralAuthorityMatches(
    use: MetricNativeLiteralUse,
    authority: MetricRequestAuthority | undefined,
    envelope: Envelope
): boolean {
    return (
        authority?.kind === 'literal' &&
        authority.origin === 'configured-joint-intake' &&
        authority.callId !== null &&
        authority.turn !== null &&
        authority.requestDigest === use.requestDigest &&
        use.requestDigest === digest(envelope.intent.trim()) &&
        authority.projectId === envelope.projectId &&
        authority.revision === envelope.baseRevision
    );
}

function nativeLiteralCandidateMatches(use: MetricNativeLiteralUse, matches: readonly RequestMetricNumber[]): boolean {
    const candidate = matches[0];
    return (
        matches.length === 1 &&
        candidate?.candidateId === use.candidateId &&
        candidate.token === use.token &&
        candidate.start === use.start
    );
}

function workflowNativeLiteralWitness(
    candidate: RequestMetricNumber,
    request: string,
    state: MetricGoalState,
    usedArguments: Set<string>
): boolean {
    const requestDigest = digest(request.trim());
    const use = state.nativeLiteralUses?.find(
        (entry) => entry.candidateId === candidate.candidateId && entry.requestDigest === requestDigest
    );
    if (use?.binding === undefined || use.binding === null) {
        return false;
    }
    const argument = `${use.binding.commandId}:${candidate.unit}`;
    if (usedArguments.has(argument)) {
        return false;
    }
    usedArguments.add(argument);
    return true;
}
