import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { getExplicitlyProtectedClips } from '../getExplicitlyProtectedClips';
import { resolveAgentReference } from '../resolveAgentReference';

import { collectClearSolosRestrictionClauses } from './collectClearSolosRestrictionClauses';
import {
    createPostTargetScopeAdmissionStrategyRegistry,
    postTargetScopeActionNames,
    type PostTargetScopeActionName,
    type PostTargetScopeAdmissionInput,
    type PostTargetScopeAdmissionResult,
    type PostTargetScopeAdmissionStrategy,
    type PostTargetScopeAdmissionStrategyDefinition,
} from './createPostTargetScopeAdmissionStrategyRegistry';
import { hasReferenceOutsideMatchedIntent } from './hasReferenceOutsideMatchedIntent';
import { hasTrackControlRestriction } from './hasTrackControlRestriction';

type PostTargetActionScope = PostTargetScopeAdmissionInput['actionScope'];

function normalizePromptText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isExplicitTrackDeletionScope({
    context,
    text,
    trackId,
}: Pick<PostTargetScopeAdmissionInput, 'context'> & { text: string; trackId: unknown }): boolean {
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

    const hasTrackNameCollision = context.tracks.some(
        (candidateTrack) =>
            candidateTrack.id !== track.id &&
            normalizePromptText(candidateTrack.name) === normalizePromptText(track.name)
    );
    if (hasTrackNameCollision) {
        const normalizedText = normalizePromptText(text);
        const hasLiteralId = normalizedText.includes(normalizePromptText(track.id));
        const hasSelection = /\b(?:selected|current|this)\b/u.test(normalizedText);
        const hasKind = new RegExp(`\\b${escapeRegExp(track.kind)}\\b`, 'u').test(normalizedText);
        if (!hasLiteralId && !hasSelection && !hasKind) {
            return false;
        }
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

function isExplicitClipDeletionScope({
    context,
    text,
    clipId,
}: Pick<PostTargetScopeAdmissionInput, 'context'> & { text: string; clipId: unknown }): boolean {
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

const universalClearSolosIntentPhrases: ReadonlySet<string> = new Set([
    'clear all solos',
    'unsolo all tracks',
    'unsolo everything',
]);

function promptHasForeignControlIntent(text: string): boolean {
    const catalog = getExecutableAppActionGroundingCatalog();
    const normalized = ` ${normalizePromptText(text)} `;
    return catalog.some((entry) => {
        if (entry.actionType === 'clearSolos') {
            return false;
        }
        return entry.intentPhrases.some((phrase) => {
            const normalizedPhrase = normalizePromptText(phrase);
            return normalizedPhrase.length > 0 && normalized.includes(` ${normalizedPhrase} `);
        });
    });
}

function isUnrelatedMuteContinuation(text: string): boolean {
    return (
        /(?:keep(?:ing)?|leav(?:e|ing)|preserv(?:e|ing)|retain(?:ing)?)/iu.test(text) && !/\bsolo(?:ed)?\b/iu.test(text)
    );
}

function getPromptSegments(prompt: string): string[] {
    return prompt
        .split(/\s+(?:and then|then|and|but)\s+|[;,\n]+|\.(?!\d)/giu)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
}

function getClearSolosFollowingNoIntentText(prompt: string, actionScope: PostTargetActionScope): string {
    const segments = getPromptSegments(prompt);
    if (segments.length === 0) {
        return '';
    }
    const startIndex = segments.findIndex(
        (segment) =>
            segment === actionScope.text.trim() ||
            normalizePromptText(segment).includes(normalizePromptText(actionScope.matchedIntentPhrase))
    );
    if (startIndex < 0) {
        return '';
    }
    let endIndex = startIndex;
    for (let index = startIndex + 1; index < segments.length; index += 1) {
        const segment = segments[index];
        if (!segment || promptHasForeignControlIntent(segment) || isUnrelatedMuteContinuation(segment)) {
            break;
        }
        endIndex = index;
    }
    if (endIndex === startIndex) {
        return '';
    }
    let searchFrom = 0;
    const ranges: { end: number; start: number }[] = [];
    for (const segment of segments) {
        const start = prompt.indexOf(segment, searchFrom);
        if (start < 0) {
            return '';
        }
        ranges.push({ start, end: start + segment.length });
        searchFrom = start + segment.length;
    }
    const start = ranges[startIndex]?.start;
    const end = ranges[endIndex]?.end;
    if (start === undefined || end === undefined || end < start) {
        return '';
    }
    return prompt.slice(start, end);
}

function getClearSolosRestrictionScanText(prompt: string, actionScope: PostTargetActionScope): string {
    const followingText = getClearSolosFollowingNoIntentText(prompt, actionScope);
    if (followingText.length === 0) {
        return actionScope.text;
    }
    const normalizedScope = normalizePromptText(actionScope.text);
    const normalizedFollowing = normalizePromptText(followingText);
    if (normalizedScope.includes(normalizedFollowing)) {
        return actionScope.text;
    }
    if (normalizedFollowing.includes(normalizedScope)) {
        return followingText;
    }
    return `${actionScope.text} ${followingText}`;
}

function isUniversalClearSolosScope(
    actionScope: PostTargetActionScope,
    context: ProjectContext,
    prompt: string
): boolean {
    if (!universalClearSolosIntentPhrases.has(normalizePromptText(actionScope.matchedIntentPhrase))) {
        return false;
    }
    const scanText = getClearSolosRestrictionScanText(prompt, actionScope);
    const restrictionEvidence = normalizePromptText(scanText);
    const hasRestriction =
        collectClearSolosRestrictionClauses(scanText).length > 0 || hasTrackControlRestriction(scanText);
    const hasRelativeTrackReference =
        /\b(?:selected|current|this|that|these|those)\s+tracks?\b/u.test(restrictionEvidence) ||
        /\btrack\s+selection\b/u.test(restrictionEvidence);
    if (hasRestriction || hasRelativeTrackReference) {
        return false;
    }
    const trackReferences = context.tracks.flatMap((track) => [track.id, track.name]);
    return !trackReferences.some((reference) =>
        hasReferenceOutsideMatchedIntent(scanText, actionScope.matchedIntentPhrase, reference)
    );
}

function validateRemoveFromVcaGroupEvidence(trackId: unknown, context: ProjectContext, prompt: string): string | null {
    if (typeof trackId !== 'string') {
        return 'Provider VCA membership target is not grounded in the user request';
    }
    const referencedGroupIds = new Set<string>();
    let hasAmbiguousGroupReference = false;
    for (const group of context.vcaGroups ?? []) {
        const result = resolveAgentReference({
            prompt,
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

function hasSelectedNoteScope(text: string): boolean {
    return (
        /\b(?:selected|current|these)(?: midi)? notes?\b/iu.test(text) ||
        /\b(?:midi )?notes? (?:that are |currently )?selected\b/iu.test(text) ||
        /\b(?:note selection|selection of (?:midi )?notes?)\b/iu.test(text)
    );
}

const midiWholeClipStrategy: PostTargetScopeAdmissionStrategy = ({ actionScope, plannedActionNames, prompt }) => {
    if (hasSelectedNoteScope(actionScope.text) || (plannedActionNames.length === 1 && hasSelectedNoteScope(prompt))) {
        return 'Selected-note edits are not supported; target the whole MIDI clip';
    }
    return null;
};

export const postTargetScopeAdmissionStrategyDefinitions = [
    {
        name: 'removeTrack',
        transform: ({ actionScope, bulkMutedEmptyTrackDeletionTargetIds, context, groundedArguments }) => {
            if (
                bulkMutedEmptyTrackDeletionTargetIds?.includes(String(groundedArguments.trackId)) ||
                isExplicitTrackDeletionScope({ context, text: actionScope.text, trackId: groundedArguments.trackId })
            ) {
                return null;
            }
            return 'Provider track deletion is not explicit in the user request';
        },
    },
    {
        name: 'removeClip',
        transform: ({ actionScope, context, groundedArguments }) =>
            isExplicitClipDeletionScope({ context, text: actionScope.text, clipId: groundedArguments.clipId })
                ? null
                : 'Provider clip deletion is not explicit in the user request',
    },
    {
        name: 'renameClip',
        transform: ({ context, groundedArguments, prompt }) =>
            getExplicitlyProtectedClips(prompt, context).some((clip) => clip.id === groundedArguments.clipId)
                ? 'Provider clip rename target is explicitly protected'
                : null,
    },
    {
        name: 'clearSolos',
        transform: ({ actionScope, context, prompt }) =>
            isUniversalClearSolosScope(actionScope, context, prompt)
                ? null
                : 'Provider clear-solos scope is not explicitly universal',
    },
    {
        name: 'removeFromVca',
        transform: ({ context, groundedArguments, prompt }) =>
            validateRemoveFromVcaGroupEvidence(groundedArguments.trackId, context, prompt),
    },
    { name: 'quantizeNotes', transform: midiWholeClipStrategy },
    { name: 'transposeNotes', transform: midiWholeClipStrategy },
    { name: 'invertNotes', transform: midiWholeClipStrategy },
    { name: 'retrogradeNotes', transform: midiWholeClipStrategy },
    { name: 'quantizeNoteLengths', transform: midiWholeClipStrategy },
    { name: 'scaleAllVelocities', transform: midiWholeClipStrategy },
    { name: 'setAllVelocities', transform: midiWholeClipStrategy },
] satisfies readonly PostTargetScopeAdmissionStrategyDefinition<PostTargetScopeActionName>[];

const postTargetScopeAdmissionStrategyRegistry =
    createPostTargetScopeAdmissionStrategyRegistry<PostTargetScopeActionName>(
        postTargetScopeAdmissionStrategyDefinitions,
        getExecutableAppActionGroundingCatalog(),
        postTargetScopeActionNames
    );

function isPostTargetScopeActionName(actionName: string): actionName is PostTargetScopeActionName {
    return postTargetScopeActionNames.some((expectedActionName) => expectedActionName === actionName);
}

export function groundPostTargetScopeAdmission(input: PostTargetScopeAdmissionInput): PostTargetScopeAdmissionResult {
    if (!isPostTargetScopeActionName(input.actionName)) {
        return null;
    }
    const strategy = postTargetScopeAdmissionStrategyRegistry.get(input.actionName);
    if (!strategy) {
        throw new Error(`Missing post-target scope admission strategy: ${input.actionName}`);
    }
    return strategy({
        actionScope: input.actionScope,
        bulkMutedEmptyTrackDeletionTargetIds: input.bulkMutedEmptyTrackDeletionTargetIds,
        context: input.context,
        groundedArguments: input.groundedArguments,
        plannedActionNames: input.plannedActionNames,
        prompt: input.prompt,
    });
}
