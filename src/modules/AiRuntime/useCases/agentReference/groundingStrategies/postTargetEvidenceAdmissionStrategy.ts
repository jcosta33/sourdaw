import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

import {
    createGroundingAdmissionStrategyRegistry,
    type GroundingAdmissionResult,
    type GroundingAdmissionStrategyDefinition,
} from './createGroundingAdmissionStrategyRegistry';
import { escapeRegExp } from './escapeRegExp';
import { getAddClipPromptEvidence } from './getAddClipPromptEvidence';
import { getMoveBeatAssertions } from './getMoveBeatAssertions';
import { getTargetPromptScope } from './getTargetPromptScope';
import { isDirectGlueClipPairScope } from './isDirectGlueClipPairScope';
import { normalizePromptText } from './normalizePromptText';
import { type ActionPromptScope } from './promptScope';

export const postTargetEvidenceActionNames = ['moveClip', 'glueClips', 'splitClip', 'addClip'] as const;

export type PostTargetEvidenceActionName = (typeof postTargetEvidenceActionNames)[number];

export type PostTargetEvidenceAdmissionInput = {
    actionName: string;
    actionScope: ActionPromptScope;
    admitsPlanCreatedObject: boolean;
    context: ProjectContext;
    groundedArguments: Readonly<Record<string, unknown>>;
};

export type PostTargetEvidenceAdmissionResult = GroundingAdmissionResult;

export type PostTargetEvidenceAdmissionStrategyDefinition<Name extends PostTargetEvidenceActionName> =
    GroundingAdmissionStrategyDefinition<Name, Omit<PostTargetEvidenceAdmissionInput, 'actionName'>>;

const postTargetEvidenceAdmissionLabel = 'post-target evidence admission';

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

export const postTargetEvidenceAdmissionStrategyDefinitions = [
    {
        name: 'moveClip',
        transform: ({ actionScope, context, groundedArguments }) =>
            isDirectMoveClipDestination(actionScope, groundedArguments.trackId, context)
                ? null
                : 'Provider clip destination is not the direct object of the move request',
    },
    {
        name: 'glueClips',
        transform: ({ actionScope, context, groundedArguments }) =>
            isDirectGlueClipPairScope(actionScope, groundedArguments.clipIds, context)
                ? null
                : 'Provider clips are not the direct objects of one glue request',
    },
    {
        name: 'splitClip',
        transform: ({ actionScope, context, groundedArguments }) =>
            isDirectSplitClipScope(actionScope, groundedArguments.clipId, context)
                ? null
                : 'Provider clip split is not scoped to the whole clip',
    },
    {
        name: 'addClip',
        transform: ({ actionScope, admitsPlanCreatedObject, context, groundedArguments }) => {
            if (admitsPlanCreatedObject) {
                return null;
            }
            const evidence = getAddClipPromptEvidence(actionScope);
            if (
                !evidence ||
                groundedArguments.startBeat !== evidence.startBeat ||
                groundedArguments.endBeat !== evidence.endBeat ||
                typeof groundedArguments.name !== 'string' ||
                normalizePromptText(groundedArguments.name) !== normalizePromptText(evidence.name)
            ) {
                return 'Provider clip creation does not match one explicit name and beat range';
            }
            if (!isDirectAddClipTarget(evidence.targetText, groundedArguments.trackId, context)) {
                return 'Provider clip container is not the direct object of the creation request';
            }
            return null;
        },
    },
] satisfies readonly PostTargetEvidenceAdmissionStrategyDefinition<PostTargetEvidenceActionName>[];

const postTargetEvidenceAdmissionStrategyRegistry = createGroundingAdmissionStrategyRegistry<
    PostTargetEvidenceActionName,
    Omit<PostTargetEvidenceAdmissionInput, 'actionName'>
>(
    postTargetEvidenceAdmissionLabel,
    postTargetEvidenceAdmissionStrategyDefinitions,
    getExecutableAppActionGroundingCatalog(),
    postTargetEvidenceActionNames
);

function isPostTargetEvidenceActionName(actionName: string): actionName is PostTargetEvidenceActionName {
    return postTargetEvidenceActionNames.some((expectedActionName) => expectedActionName === actionName);
}

export function groundPostTargetEvidenceAdmission(
    input: PostTargetEvidenceAdmissionInput
): PostTargetEvidenceAdmissionResult {
    if (!isPostTargetEvidenceActionName(input.actionName)) {
        return null;
    }
    const strategy = postTargetEvidenceAdmissionStrategyRegistry.get(input.actionName);
    if (!strategy) {
        throw new Error(`Missing ${postTargetEvidenceAdmissionLabel} strategy: ${input.actionName}`);
    }
    return strategy({
        actionScope: input.actionScope,
        admitsPlanCreatedObject: input.admitsPlanCreatedObject,
        context: input.context,
        groundedArguments: input.groundedArguments,
    });
}
