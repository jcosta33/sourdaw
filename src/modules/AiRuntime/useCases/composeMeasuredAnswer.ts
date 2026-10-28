import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';
import { compareAgentScopeMeasurements } from '#/modules/AudioAnalysis/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AnswerOnsets } from '../models/AnswerEvidence';
import { ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS, type PlanningAnswer } from '../models/AnswerRespond';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

import {
    type AnswerMeasurement,
    type AnswerRequestAuthority,
    type AnswerMetricId,
    type AnswerMetricReference,
    type AnswerRespondArguments,
    type AnswerStatement,
} from './answerContractTypes';
import { type RecipeDiscoveryReceiptData } from './discoverMixRecipes';

export type AnswerReadSource =
    | { kind: 'measurement'; value: AnswerMeasurement }
    | { kind: 'recipe'; value: RecipeDiscoveryReceiptData }
    | { kind: 'query-page'; value: { queryType: string; itemCount: number; total: number } }
    | { kind: 'source-onsets'; value: AnswerOnsets };
export type AdmittedAnswerRead = { receipt: ApplicationToolReceipt; source: AnswerReadSource };
export type AdmittedAnswerIntake = { callId: string; turn: number; authority: AnswerRequestAuthority };
type Composition = { status: 'accepted'; answer: PlanningAnswer } | { status: 'rejected'; reason: string };
type Metric = {
    reference: AnswerMetricReference;
    measurement: AnswerMeasurement;
    target: AnswerMeasurement['targets'][number];
    entry: NonNullable<AnswerMeasurement['targets'][number]['measurements'][AnswerMetricId]>;
    value: number;
    unit: string;
    confidence: string;
};

const METRIC_LABELS: Record<AnswerMetricId, string> = {
    integratedLoudness: 'integrated loudness',
    shortTermLoudnessMax: 'maximum short-term loudness',
    momentaryLoudnessMax: 'maximum momentary loudness',
    truePeak: 'true peak',
    rms: 'RMS level',
    crestFactor: 'crest factor',
    dynamicRangeEstimate: 'estimated dynamic range',
    spectralCentroid: 'spectral centroid',
    frequencyBandEnergy: 'frequency-band energy',
    stereoCorrelation: 'stereo correlation',
    sideEnergyFraction: 'side energy fraction',
    lowFrequencyStereoContent: 'low-frequency stereo content',
    transientDensity: 'transient density',
    onsetCount: 'onset count',
};
const METRIC_UNITS: Record<AnswerMetricId, string> = {
    integratedLoudness: 'LUFS',
    shortTermLoudnessMax: 'LUFS',
    momentaryLoudnessMax: 'LUFS',
    truePeak: 'dBTP',
    rms: 'dBFS',
    crestFactor: 'dB',
    dynamicRangeEstimate: 'dB',
    spectralCentroid: 'hertz',
    frequencyBandEnergy: 'ratio',
    stereoCorrelation: 'correlation',
    sideEnergyFraction: 'ratio',
    lowFrequencyStereoContent: 'ratio',
    transientDensity: 'per-second',
    onsetCount: 'count',
};
const LIMITATIONS = {
    'measurement-unavailable':
        'A successful measurement covering the interpreted subject, range and metrics is unavailable. I cannot report audio figures for this question.',
    'timing-unavailable':
        'Track alignment and timing offsets are unavailable from these measurements. Source-buffer onsets do not establish track alignment.',
    'bounded-evidence': 'This answer is limited to the available bounded evidence.',
    'perception-not-inferred': 'These objective measurements do not establish perceived sound quality or its cause.',
};
/** Names are attributed data, including digits, units and Markdown metacharacters. */
function quoteSourceData(value: string): string {
    return `“${value.replaceAll(/[\\`*_{}[\]()<>!#|~]/g, '\\$&').replaceAll(/[\r\n]/g, ' ')}”`;
}
function formatAnswerNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return 'unavailable';
    }
    const rounded = Math.round(value * 100) / 100;
    return String(Object.is(rounded, -0) ? 0 : rounded);
}
function formatSubjectLabel(authority: AnswerRequestAuthority, id: string): string {
    if (id === 'master') {
        return 'Master output';
    }
    const scope = authority.scopes.find((candidate) => candidate.objectIds.includes(id));
    const index = scope?.objectIds.indexOf(id) ?? -1;
    return quoteSourceData(index >= 0 ? scope!.labels[index]! : id);
}
function interpretedTargetIds(authority: AnswerRequestAuthority): string[] {
    return authority.scopes.flatMap((scope) => scope.objectIds);
}
function formatRangeLabel(authority: AnswerRequestAuthority): string {
    const range = authority.range;
    return range === null
        ? ''
        : `Over ${quoteSourceData(range.label)} (beats ${formatAnswerNumber(range.startBeat)}–${formatAnswerNumber(range.endBeat)})`;
}
function sameMembers(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
}
function compatibleCoverage(measurement: AnswerMeasurement, authority: AnswerRequestAuthority): boolean {
    const { range } = authority;
    const scope = authority.scopes.find(
        (candidate) => candidate.kind === (measurement.scope.kind === 'project' ? 'master' : measurement.scope.kind)
    );
    if (
        authority.kind !== 'measured-audio' ||
        scope === undefined ||
        range === null ||
        measurement.revision !== authority.revision ||
        measurement.range.startBeat !== range.startBeat ||
        measurement.range.endBeat !== range.endBeat ||
        measurement.range.sectionId !== range.sectionId ||
        !authority.requiredMetrics.every((metric) => measurement.metrics.includes(metric))
    ) {
        return false;
    }
    if (scope.kind === 'master') {
        return (
            (measurement.scope.kind === 'master' || measurement.scope.kind === 'project') &&
            measurement.targets.length === 1 &&
            measurement.targets[0]?.targetKind === 'master' &&
            measurement.targets[0].targetId === 'master' &&
            measurement.targets[0].route === 'mixdown' &&
            measurement.targets[0].artifact.contentAddress.length > 0
        );
    }
    return (
        (measurement.scope.kind === 'tracks' || measurement.scope.kind === 'buses') &&
        scope.kind === measurement.scope.kind &&
        measurement.scope.ids.every((id) => scope.objectIds.includes(id)) &&
        sameMembers(
            measurement.scope.ids,
            measurement.targets.map((target) => target.targetId)
        ) &&
        measurement.targets.every(
            (target) =>
                target.targetKind === (scope.kind === 'tracks' ? 'track' : 'bus') &&
                target.route === 'isolated-subgraph' &&
                target.artifact.contentAddress.length > 0
        )
    );
}
function resolveMetricReference(
    reference: AnswerMetricReference,
    intake: AdmittedAnswerIntake,
    reads: ReadonlyMap<string, AdmittedAnswerRead>
): Metric | null {
    const read = reads.get(reference.callId);
    if (
        read?.source.kind !== 'measurement' ||
        read.receipt.turn <= intake.turn ||
        read.receipt.revision !== intake.authority.revision ||
        !compatibleCoverage(read.source.value, intake.authority)
    ) {
        return null;
    }
    const measurement = read.source.value;
    const target = measurement.targets.find((entry) => entry.targetId === reference.targetId);
    const entry = target?.measurements[reference.metricId];
    if (target === undefined || entry?.status !== 'measured' || entry.unit !== METRIC_UNITS[reference.metricId]) {
        return null;
    }
    let value: unknown = entry.value;
    if (reference.band !== undefined) {
        value = undefined;
        if (
            typeof entry.value === 'object' &&
            !Array.isArray(entry.value) &&
            entry.value !== null &&
            Object.hasOwn(entry.value, reference.band)
        ) {
            value = (entry.value as Readonly<Record<string, number>>)[reference.band];
        }
    }
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (reference.metricId === 'frequencyBandEnergy' && reference.band === undefined)
    ) {
        return null;
    }
    return { reference, measurement, target, entry, value, unit: entry.unit, confidence: entry.confidence };
}
/** Project renders report physical units; coverage already validates each target's render route. */
function areComparableMetrics(left: Metric, right: Metric): boolean {
    return (
        left.reference.metricId === right.reference.metricId &&
        left.reference.band === right.reference.band &&
        left.unit === right.unit &&
        left.measurement.revision === right.measurement.revision &&
        left.measurement.range.startBeat === right.measurement.range.startBeat &&
        left.measurement.range.endBeat === right.measurement.range.endBeat
    );
}
function metricLabel(ref: AnswerMetricReference): string {
    return METRIC_LABELS[ref.metricId] + (ref.band === undefined ? '' : ` in band ${quoteSourceData(ref.band)}`);
}
function displayUnit(unit: string): string {
    if (unit === 'hertz') {
        return 'Hz';
    }
    return unit === 'per-second' ? 'per second' : unit;
}
function describeMetric(value: Metric, authority: AnswerRequestAuthority): string {
    return `${formatSubjectLabel(authority, value.reference.targetId)} ${metricLabel(value.reference)} is ${formatAnswerNumber(value.value)} ${displayUnit(value.unit)} (${value.confidence})`;
}
function projectFact(
    fact: Extract<AnswerStatement, { kind: 'project-fact' }>['fact'],
    authority: AnswerRequestAuthority
): string {
    const context = authority.context;
    switch (fact) {
        case 'summary':
            return `The project has ${String(context.tracks.filter((track) => track.kind === 'audio' || track.kind === 'midi').length)} audio/MIDI track(s), ${String(context.tracks.filter((track) => track.kind === 'bus').length)} bus(es), and ${String(context.tracks.filter((track) => track.kind === 'folder').length)} folder(s). Master output is separate. Tempo is ${formatAnswerNumber(context.tempo)} BPM in ${String(context.timeSignature[0])}/${String(context.timeSignature[1])}.`;
        case 'tempo':
            return `The project tempo setting is ${formatAnswerNumber(context.tempo)} BPM; the time signature is ${String(context.timeSignature[0])}/${String(context.timeSignature[1])}.`;
        case 'tracks':
            return context.tracks.length === 0
                ? 'The project has no tracks.'
                : `Project tracks: ${context.tracks.map((track) => `${quoteSourceData(track.name)} (${quoteSourceData(track.kind)}, ${String(track.clips.length)} captured clip(s))`).join('; ')}.`;
        case 'sections':
            return (context.sections ?? []).length === 0
                ? 'The project has no named sections.'
                : `Named sections: ${context.sections!.map((section) => `${quoteSourceData(section.name)}, beats ${formatAnswerNumber(section.startBeat)}–${formatAnswerNumber(section.endBeat)}`).join('; ')}.`;
        case 'transport':
            return `Transport is ${context.isPlaying ? 'playing' : 'stopped'}; recording is ${context.isRecording ? 'on' : 'off'}; looping is ${context.isLooping ? 'on' : 'off'}.`;
        case 'settings': {
            let trackSettings = '';
            if (context.tracks.length > 0) {
                trackSettings = `; ${context.tracks.map((track) => `${quoteSourceData(track.name)} ${formatAnswerNumber(track.gain)}`).join('; ')}`;
            }
            return `Project fader settings (linear gain, not measured audio): master ${formatAnswerNumber(context.masterGain)}${trackSettings}.`;
        }
    }
}
function recipeText(recipe: RecipeDiscoveryReceiptData['candidates'][number]): string {
    const descriptors = getAgentBuiltinDeviceFactoryManifest(recipe.steps.map((step) => step.deviceType));
    const windows = recipe.steps.flatMap((step) =>
        step.parameters.flatMap((parameter) => {
            const descriptor = descriptors
                .find((entry) => entry.type === step.deviceType)
                ?.parameters.find((entry) => entry.id === parameter.paramId);
            if (
                descriptor === undefined ||
                !Number.isFinite(parameter.minimum) ||
                !Number.isFinite(parameter.maximum)
            ) {
                return [];
            }
            return [
                `${quoteSourceData(descriptor.name)} ${formatAnswerNumber(parameter.minimum)}–${formatAnswerNumber(parameter.maximum)} ${quoteSourceData(descriptor.unit)}`,
            ];
        })
    );
    let text = `The catalog recipe ${quoteSourceData(recipe.title)} describes ${quoteSourceData(recipe.descriptor)} (${quoteSourceData(recipe.effect)}). These are authored suggestions, not measurements of this project.`;
    if (recipe.prerequisites.length > 0) {
        text += ` Prerequisites: ${recipe.prerequisites.map(quoteSourceData).join('; ')}.`;
    }
    if (recipe.contraindications.length > 0) {
        text += ` Contraindications: ${recipe.contraindications.map(quoteSourceData).join('; ')}.`;
    }
    if (windows.length > 0) {
        text += ` Authored parameter windows: ${windows.join('; ')}.`;
    }
    return text;
}

type StatementText = { text: string; callIds: string[] };

function composeDifference(
    statement: Extract<AnswerStatement, { kind: 'difference' }>,
    intake: AdmittedAnswerIntake,
    reads: ReadonlyMap<string, AdmittedAnswerRead>
): StatementText | null {
    const left = resolveMetricReference(statement.left, intake, reads);
    const right = resolveMetricReference(statement.right, intake, reads);
    if (left === null || right === null || !areComparableMetrics(left, right) || left.reference.band !== undefined) {
        return null;
    }
    const compared = compareAgentScopeMeasurements({
        preview: left.target.measurements,
        baseline: right.target.measurements,
    })[left.reference.metricId];
    if (compared?.status !== 'compared' || !Number.isFinite(compared.delta)) {
        return null;
    }
    const authority = intake.authority;
    return {
        text: `${formatRangeLabel(authority)}, ${formatSubjectLabel(authority, statement.left.targetId)} minus ${formatSubjectLabel(authority, statement.right.targetId)} in ${metricLabel(statement.left)} is ${formatAnswerNumber(compared.delta)} ${displayUnit(compared.unit)}. This numerical difference does not establish perceived quality.`,
        callIds: [statement.left.callId, statement.right.callId],
    };
}

function composeRanking(
    statement: Extract<AnswerStatement, { kind: 'ranking' }>,
    intake: AdmittedAnswerIntake,
    reads: ReadonlyMap<string, AdmittedAnswerRead>
): StatementText | null {
    const values = statement.references.map((ref) => resolveMetricReference(ref, intake, reads));
    if (values.some((value) => value === null)) {
        return null;
    }
    const resolved = values.filter((value) => value !== null);
    const first = resolved[0];
    const authority = intake.authority;
    if (
        first === undefined ||
        !sameMembers(
            resolved.map((value) => value.reference.targetId),
            interpretedTargetIds(authority)
        ) ||
        resolved.some((value) => !areComparableMetrics(first, value))
    ) {
        return null;
    }
    const descending = statement.operation === 'descending' || statement.operation === 'maximum';
    resolved.sort((left, right) => (descending ? right.value - left.value : left.value - right.value));
    let shown = resolved;
    if (statement.operation === 'minimum' || statement.operation === 'maximum') {
        shown = resolved.filter((value) => value.value === resolved[0]!.value);
    }
    const groups = shown.map(
        (value, index) =>
            `${shown[index - 1]?.value === value.value ? 'tied: ' : ''}${describeMetric(value, authority)}`
    );
    return {
        text: `${formatRangeLabel(authority)}, ${statement.operation} by ${metricLabel(first.reference)} across the complete selected scope: ${groups.join('; ')}.`,
        callIds: statement.references.map((ref) => ref.callId),
    };
}

function composeSourceOnsets(
    source: AnswerOnsets,
    intake: AdmittedAnswerIntake,
    receipt: ApplicationToolReceipt
): string | null {
    const authority = intake.authority;
    if (
        authority.kind !== 'source-onsets' ||
        !authority.scopes.some((scope) => scope.kind === 'clips' && scope.objectIds.includes(source.clipId)) ||
        source.sourceRevisionDigest !== digest(authority.revision) ||
        source.timeAxis !== 'source-buffer' ||
        receipt.turn <= intake.turn ||
        source.hits.some((hit) => !Number.isFinite(hit.sourceSeconds) || !Number.isFinite(hit.confidence))
    ) {
        return null;
    }
    return `Source-buffer onsets for ${formatSubjectLabel(authority, source.clipId)}: this page has ${String(source.hits.length)} hit(s), offsets ${String(source.coverage.offset)}–${String(source.coverage.endOffset)}, of ${String(source.totalHitCount)} total. Source-buffer times: ${source.hits.map((hit) => `${formatAnswerNumber(hit.sourceSeconds)} seconds (confidence ${formatAnswerNumber(hit.confidence)})`).join(', ')}. These are source-buffer times, not arrangement beats or track alignment.`;
}

function composeReadStatement(
    statement: Extract<AnswerStatement, { callId: string }>,
    intake: AdmittedAnswerIntake,
    reads: ReadonlyMap<string, AdmittedAnswerRead>
): StatementText | null {
    const read = reads.get(statement.callId);
    if (read === undefined) {
        return null;
    }
    if (statement.kind === 'query-page' && read.source.kind === 'query-page') {
        return {
            text: `The ${quoteSourceData(read.source.value.queryType)} query returned ${String(read.source.value.itemCount)} item(s) on this page out of ${String(read.source.value.total)} matching item(s).`,
            callIds: [statement.callId],
        };
    }
    if (
        statement.kind === 'recipe' &&
        read.source.kind === 'recipe' &&
        (intake.authority.kind === 'catalog-knowledge' || intake.authority.kind === 'measured-audio')
    ) {
        const candidate = read.source.value.candidates.find((entry) => entry.id === statement.recipeId);
        return candidate === undefined ? null : { text: recipeText(candidate), callIds: [statement.callId] };
    }
    if (statement.kind === 'source-onsets' && read.source.kind === 'source-onsets') {
        const text = composeSourceOnsets(read.source.value, intake, read.receipt);
        return text === null ? null : { text, callIds: [statement.callId] };
    }
    return null;
}

function composeStatement(
    statement: AnswerStatement,
    intake: AdmittedAnswerIntake,
    reads: ReadonlyMap<string, AdmittedAnswerRead>
): StatementText | null {
    const authority = intake.authority;
    switch (statement.kind) {
        case 'limitation':
            if (statement.code === 'measurement-unavailable' && hasCompleteMeasurement(intake, reads)) {
                return null;
            }
            return { text: LIMITATIONS[statement.code], callIds: [] };
        case 'project-fact':
            if (authority.kind === 'project-facts' || authority.kind === 'measured-audio') {
                return { text: projectFact(statement.fact, authority), callIds: [] };
            }
            return null;
        case 'metric': {
            const value = resolveMetricReference(statement.reference, intake, reads);
            if (value === null) {
                return null;
            }
            return {
                text: `${formatRangeLabel(authority)}, ${describeMetric(value, authority)}.`,
                callIds: [statement.reference.callId],
            };
        }
        case 'difference':
            return composeDifference(statement, intake, reads);
        case 'ranking':
            return composeRanking(statement, intake, reads);
        default:
            return composeReadStatement(statement, intake, reads);
    }
}

function hasCompleteMeasurement(intake: AdmittedAnswerIntake, reads: ReadonlyMap<string, AdmittedAnswerRead>): boolean {
    if (intake.authority.kind !== 'measured-audio' || interpretedTargetIds(intake.authority).length === 0) {
        return false;
    }
    const covered = new Set<string>();
    for (const read of reads.values()) {
        if (
            read.source.kind === 'measurement' &&
            read.receipt.turn > intake.turn &&
            read.receipt.revision === intake.authority.revision &&
            compatibleCoverage(read.source.value, intake.authority)
        ) {
            for (const target of read.source.value.targets) {
                covered.add(target.targetId);
            }
        }
    }
    return interpretedTargetIds(intake.authority).every((id) => covered.has(id));
}

/** Every factual clause and calculation is application-owned; provider input selects finite references only. */
export function composeMeasuredAnswer(input: {
    document: AnswerRespondArguments;
    intake: AdmittedAnswerIntake | null;
    reads: ReadonlyMap<string, AdmittedAnswerRead>;
    receipts: readonly ApplicationToolReceipt[];
}): Composition {
    const { document, intake, reads } = input;
    const rejection: Composition = {
        status: 'rejected',
        reason: 'Answer references evidence outside its frozen interpretation or successful bounded reads.',
    };
    if (intake === null || intake.callId !== document.intakeCallId) {
        return rejection;
    }
    const authority = intake.authority;
    const completeMeasurement = hasCompleteMeasurement(intake, reads);
    const unsupportedTiming = authority.kind === 'measured-audio' && authority.topics.includes('timing');
    const hasMetricStatement = document.statements.some((entry) =>
        ['metric', 'difference', 'ranking'].includes(entry.kind)
    );
    if (authority.kind === 'measured-audio' && completeMeasurement && !unsupportedTiming && !hasMetricStatement) {
        return rejection;
    }
    const missingMeasurement = authority.kind === 'measured-audio' && !completeMeasurement;
    let statements: Array<StatementText | null>;
    if (missingMeasurement || unsupportedTiming) {
        statements = [
            {
                text: unsupportedTiming ? LIMITATIONS['timing-unavailable'] : LIMITATIONS['measurement-unavailable'],
                callIds: [],
            },
        ];
    } else {
        statements = document.statements.map((statement) => composeStatement(statement, intake, reads));
    }
    if (statements.some((statement) => statement === null)) {
        return rejection;
    }
    const resolved = statements.filter((statement) => statement !== null);
    const evidenceIds = new Set([intake.callId, ...resolved.flatMap((statement) => statement.callIds)]);
    const evidence: PlanningAnswer['evidence'] = [];
    for (const callId of evidenceIds) {
        const receipt = input.receipts.find((entry) => entry.callId === callId && entry.status === 'success');
        if (receipt === undefined) {
            return rejection;
        }
        evidence.push({ callId, toolName: receipt.toolName, summary: receipt.summary });
    }
    const text = resolved.map((statement) => statement.text).join('\n\n');
    return {
        status: 'accepted',
        answer: {
            text: text.length > ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS ? LIMITATIONS['bounded-evidence'] : text,
            evidence,
        },
    };
}
