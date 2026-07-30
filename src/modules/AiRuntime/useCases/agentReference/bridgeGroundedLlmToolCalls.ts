import {
    getExecutableAppActionGroundingCatalog,
    getExecutableAppActionGroundingRules,
} from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeLlmToolCalls, type LlmActionRejection } from '../../transformers/llmActionBridge';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../../transformers/llmActionLimits';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { resolveAgentReference } from './resolveAgentReference';

type BridgeGroundedLlmToolCallsInput = {
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    prompt: string;
};

type GroundToolCallInput = {
    actionOrdinal: number;
    call: ToolCallResult;
    catalog: GroundingCatalog;
    context: ProjectContext;
    index: number;
    prompt: string;
    plannedActionNames: readonly string[];
    sameActionCallCount: number;
};

type PromptClause = {
    masked: string;
    text: string;
};

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;
type GroundingRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>;

type ActionPromptScope = PromptClause & {
    matchedIntentPhrase: string;
};

type ResolveActionPromptScopeInput = {
    actionName: string;
    actionOrdinal: number;
    catalog: GroundingCatalog;
    context: ProjectContext;
    prompt: string;
    plannedActionNames: readonly string[];
    sameActionCallCount: number;
};

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
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
        const intent = resolveClauseActionIntent(clause.text, clause.masked, plannedCatalog);
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

function isExplicitCommandClause(maskedText: string, catalog: GroundingCatalog): boolean {
    if (/["“”]/u.test(maskedText)) {
        return false;
    }
    let commandText = normalizePromptText(maskedText);
    if (/\b(?:if|unless|maybe|perhaps)\b/u.test(commandText)) {
        return false;
    }
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/u, '');
    commandText = commandText.replace(/^please\s+/u, '');
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
    text: string,
    maskedText: string,
    catalog: GroundingCatalog
): ClauseActionIntent | null {
    if (!isExplicitCommandClause(maskedText, catalog)) {
        return null;
    }
    const matches = catalog
        .flatMap((entry) =>
            entry.intentPhrases.map((phrase) => ({
                actionType: entry.actionType,
                index: getIntentPhraseIndex(text, phrase),
                phrase,
            }))
        )
        .filter((match) => match.index >= 0 && !isNegatedIntent(text, match.phrase))
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
        return null;
    }
    return first;
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function getProjectReferenceTexts(context: ProjectContext): string[] {
    const references = context.tracks.flatMap((track) => [
        track.id,
        track.name,
        ...track.devices.flatMap((device) => [
            device.id,
            device.type,
            ...(device.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.name]),
        ]),
    ]);
    return [...new Set(references)]
        .filter((reference) => reference.length > 0)
        .sort((left, right) => right.length - left.length);
}

function maskProjectReferences(prompt: string, context: ProjectContext): string {
    let maskedPrompt = prompt;
    for (const reference of getProjectReferenceTexts(context)) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu');
        maskedPrompt = maskedPrompt.replaceAll(pattern, (match) => '□'.repeat(match.length));
    }
    return maskedPrompt;
}

function getPromptClauses(prompt: string, maskedPrompt: string): PromptClause[] {
    const clauses: PromptClause[] = [];
    const separatorPattern = /\s+(?:and then|then|and)\s+|[;,\n]+|(?<!\d)\.|\.(?!\d)/giu;
    let start = 0;
    for (const match of maskedPrompt.matchAll(separatorPattern)) {
        if (prompt.slice(start, match.index).trim().length > 0) {
            clauses.push({ text: prompt.slice(start, match.index), masked: maskedPrompt.slice(start, match.index) });
        }
        start = match.index + match[0].length;
    }
    if (prompt.slice(start).trim().length > 0) {
        clauses.push({ text: prompt.slice(start), masked: maskedPrompt.slice(start) });
    }
    return clauses;
}

function resolveActionPromptScope({
    actionName,
    actionOrdinal,
    catalog,
    context,
    prompt,
    plannedActionNames,
    sameActionCallCount,
}: ResolveActionPromptScopeInput): ActionPromptScope | null {
    const groundingRules = getExecutableAppActionGroundingRules(actionName);
    if (!groundingRules || hasTrailingIntentCancellation(prompt, actionName, catalog, plannedActionNames)) {
        return null;
    }
    const maskedPrompt = groundingRules.targetRules.length === 0 ? prompt : maskProjectReferences(prompt, context);
    const matchingScopes: ActionPromptScope[] = [];
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const intent = resolveClauseActionIntent(clause.text, clause.masked, catalog);
        if (intent?.actionType === actionName) {
            matchingScopes.push({ ...clause, matchedIntentPhrase: intent.phrase });
        }
    }
    if (matchingScopes.length !== sameActionCallCount) {
        return null;
    }
    return matchingScopes[actionOrdinal] ?? null;
}

function getTargetPromptScope(actionScope: ActionPromptScope, promptRole?: 'source' | 'destination'): string {
    if (!promptRole) {
        return actionScope.text;
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

function findDirectionBoundNumber(maskedScope: string, numbers: readonly PromptNumber[]): PromptNumber | null {
    return numbers.find((number) => /^\s*(?:left|right)\b/iu.test(maskedScope.slice(number.end))) ?? null;
}

function normalizePromptNumber(
    number: PromptNumber,
    actionScope: ActionPromptScope,
    valueRule: Extract<GroundingValueRule, { kind: 'number-if-present' }>
): number {
    const isPercentage = number.raw.endsWith('%');
    let value = Number.parseFloat(number.raw);
    if (valueRule.scale === 'unit-interval' && (isPercentage || Math.abs(value) > 1)) {
        value /= 100;
    }
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

function getExpectedNumbers(actionScope: ActionPromptScope, valueRule: GroundingValueRule): number[] | null {
    if (valueRule.kind !== 'number-if-present') {
        return [];
    }
    const numbers = [...actionScope.masked.matchAll(/-?\d+(?:\.\d+)?%?/gu)].map((match) => ({
        end: match.index + match[0].length,
        index: match.index,
        raw: match[0],
    }));
    if (numbers.length === 0) {
        return [];
    }
    const boundNumber =
        findConnectorBoundNumber(actionScope.masked, numbers) ?? findDirectionBoundNumber(actionScope.masked, numbers);
    if (boundNumber) {
        return [normalizePromptNumber(boundNumber, actionScope, valueRule)];
    }
    if (numbers.length > 1) {
        return null;
    }
    const onlyNumber = numbers[0];
    if (!onlyNumber) {
        return [];
    }
    return [normalizePromptNumber(onlyNumber, actionScope, valueRule)];
}

function getTextAfterKeyword(actionScope: ActionPromptScope, keywords: readonly string[]): string | null {
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
    return actionScope.text.slice(match.index + match[0].length).trim();
}

function getValueMismatchReason(argument: string): string {
    return `Provider value ${argument} does not match the user request`;
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

function validateNumberValue(
    valueRule: NumberValueRule,
    assertedValue: unknown,
    actionScope: ActionPromptScope,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): string | null {
    if (typeof assertedValue !== 'number') {
        return getValueMismatchReason(valueRule.argument);
    }
    const expectedNumbers = getExpectedNumbers(actionScope, valueRule);
    if (expectedNumbers === null) {
        return getValueMismatchReason(valueRule.argument);
    }
    const matchesExpectedValue = expectedNumbers.some((expected) => Math.abs(expected - assertedValue) < 0.000_001);
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
    actionScope: ActionPromptScope
): string | null {
    if (typeof assertedValue !== 'string' || getIntentPhraseIndex(actionScope.masked, assertedValue) < 0) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateEnumValue(
    valueRule: Extract<GroundingValueRule, { kind: 'enum-if-present' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope
): string | null {
    const mentionedValues = valueRule.values.filter((value) => getIntentPhraseIndex(actionScope.masked, value) >= 0);
    if (mentionedValues.length > 0 && !mentionedValues.includes(String(assertedValue))) {
        return getValueMismatchReason(valueRule.argument);
    }
    return null;
}

function validateTextAfterKeywordValue(
    valueRule: Extract<GroundingValueRule, { kind: 'text-after-keyword-if-present' }>,
    assertedValue: unknown,
    actionScope: ActionPromptScope
): string | null {
    const expectedValue = getTextAfterKeyword(actionScope, valueRule.keywords);
    if (expectedValue === null) {
        return null;
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
        case 'time-signature':
            return validateTimeSignatureValue(valueRule, assertedValue, actionScope, groundedArguments, context);
        case 'string-literal':
            return validateStringLiteralValue(valueRule, assertedValue, actionScope);
        case 'enum-if-present':
            return validateEnumValue(valueRule, assertedValue, actionScope);
        case 'text-after-keyword-if-present':
            return validateTextAfterKeywordValue(valueRule, assertedValue, actionScope);
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

function groundToolCall({
    actionOrdinal,
    call,
    catalog,
    context,
    index,
    prompt,
    plannedActionNames,
    sameActionCallCount,
}: GroundToolCallInput): ToolCallResult | LlmActionRejection {
    const groundingRules = getExecutableAppActionGroundingRules(call.name);
    if (!groundingRules) {
        return call;
    }
    const actionScope = resolveActionPromptScope({
        actionName: call.name,
        actionOrdinal,
        catalog,
        context,
        prompt,
        plannedActionNames,
        sameActionCallCount,
    });
    if (!actionScope) {
        return rejection(index, call.name, 'Provider action is not grounded in the user request');
    }

    const groundedArguments = { ...call.arguments };
    for (const targetRule of groundingRules.targetRules) {
        const assertedValue = groundedArguments[targetRule.argument];
        const dependencyValue = targetRule.dependsOn ? groundedArguments[targetRule.dependsOn] : undefined;
        const distinctValue = targetRule.distinctFrom ? groundedArguments[targetRule.distinctFrom] : undefined;
        if (targetRule.distinctFrom && typeof distinctValue === 'string' && assertedValue === distinctValue) {
            return rejection(
                index,
                call.name,
                `Target ${targetRule.argument} must be distinct from ${targetRule.distinctFrom}`
            );
        }
        const targetPrompt = getTargetPromptScope(actionScope, targetRule.promptRole);
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
    const valueRejection = validateGroundedValues(groundingRules, groundedArguments, actionScope, context);
    if (valueRejection) {
        return rejection(index, call.name, valueRejection);
    }

    return { ...call, arguments: groundedArguments };
}

export function bridgeGroundedLlmToolCalls({ calls, context, prompt }: BridgeGroundedLlmToolCallsInput) {
    if (calls.length > MAX_LLM_ACTIONS_PER_BATCH) {
        return bridgeLlmToolCalls({ calls, context });
    }
    const catalog = getExecutableAppActionGroundingCatalog();
    const groundingRejections = new Map<number, LlmActionRejection>();
    const groundedCalls = calls.map((call, index) => {
        const actionOrdinal = calls.slice(0, index).filter((candidate) => candidate.name === call.name).length;
        const sameActionCallCount = calls.filter((candidate) => candidate.name === call.name).length;
        const grounded = groundToolCall({
            actionOrdinal,
            call,
            catalog,
            context,
            index,
            prompt,
            plannedActionNames: calls.map((candidate) => candidate.name),
            sameActionCallCount,
        });
        if ('reason' in grounded) {
            groundingRejections.set(index, grounded);
            return { name: '<rejected-target-reference>', arguments: {} };
        }
        return grounded;
    });
    const bridged = bridgeLlmToolCalls({ calls: groundedCalls, context });
    return {
        actions: bridged.actions,
        rejections: bridged.rejections.map((bridgeRejection) => {
            if (bridgeRejection.name === '<batch>') {
                return bridgeRejection;
            }
            return groundingRejections.get(bridgeRejection.index) ?? bridgeRejection;
        }),
    };
}
