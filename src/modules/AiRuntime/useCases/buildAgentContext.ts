import { toLevelDb } from '#/utils/audioLevelLaw';
import { digest } from '#/utils/canonicalDigest';

import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../models/AgentContext';
import { type AgentRunBudgets, type AgentRunGrants } from '../models/AgentRun';
import { type PlanningRejectionEvidence } from '../models/PlanningRejectionEvidence';
import { PROJECT_CONTEXT_LEVEL_LAW, type ProjectContext } from '../models/ProjectContext';
import {
    buildLlmActionUserMessage,
    type LlmActionCapabilityData,
    type LlmActionMessageProfile,
} from '../transformers/llmActionBridge';

const MAX_CONTEXT_TARGETS = 64;
const MAX_VALIDATION_FAILURES = 16;
const MAX_SELECTED_CLIPS = 16;
const MAX_IMPORTED_STRING_LENGTH = 512;
const MAX_RECEIPTS = 16;
/**
 * Receipt summaries carry application-owned tool evidence, not imported project or prompt text, so
 * they hold their own budget instead of the general imported-string bound. The budget is the total
 * across every retained receipt, which keeps the worst-case message contribution identical to the
 * previous MAX_RECEIPTS * MAX_IMPORTED_STRING_LENGTH aggregate while letting a single receipt spend
 * the whole allowance. This constant is the only owner of that budget: callers pass whole summaries
 * and read the reported `truncated` flag.
 */
const MAX_RECEIPT_EVIDENCE_LENGTH = 8_192;
const MAX_MEASUREMENTS = 16;
/** The rejection fragment quotes provider output back to it; it stays small and trust-labeled. */
const MAX_REJECTION_FRAGMENT_LENGTH = 512;
const MAX_REJECTION_CANDIDATES = 8;
/**
 * The characters the capability data may take in `capability_schemas`, hosted and local alike.
 * Both copies are bounded at whole capability entries, never a character slice: a cut mid-value
 * would only hand the model malformed JSON it cannot parse. Entries that cannot fit whole are
 * omitted whole and named — in the hosted copy's sibling `omittedCapabilityNames` field, whose
 * full capability data still rides the hosted project_context, and in the local message's
 * `context_omissions` — so the worst case is an empty object plus the full omission list.
 */
const MAX_AVAILABLE_CAPABILITIES_LENGTH = 8_192;
/**
 * What a local model reads when the capped sections left part of the project out. The hosted
 * project context restates everything; the local one restates none of it, so the model is told
 * where the rest is.
 */
const PROJECT_SECTION_OMISSIONS = `untrusted_project_data lists at most ${String(MAX_CONTEXT_TARGETS)} tracks, ${String(MAX_SELECTED_CLIPS)} clips and ${String(MAX_CONTEXT_TARGETS)} sends on each, and ${String(MAX_CONTEXT_TARGETS)} sections and automation lanes, and its omitted counts and targetCount say what it left out; read the rest with project.query.`;
/**
 * How a capability entry comes to be in the request, which decides its place when the entries do
 * not all fit. A `request` capability exists only because the request asked for its workflow: the
 * sidechain routing scope matches the request's own wording, and the stem import scope exists only
 * after the planner asked to prepare an import. A `project` capability is derived from the project
 * alone whenever its shape fits the workflow, so the request may or may not need it. The
 * `creative` catalog interprets a request no workflow covers. Every key has a kind, so a new
 * capability cannot be added without one.
 */
const LOCAL_CAPABILITY_KIND = {
    sidechainRoutingCapability: 'request',
    stemImportCapability: 'request',
    articulationTransferCapability: 'project',
    backingVocalPlateCapability: 'project',
    bassProcessingCopyCapability: 'project',
    drumRoutingCapability: 'project',
    drumRenderComparisonCapability: 'project',
    drumPreviewBranchesCapability: 'project',
    midiOverlapTransformCapability: 'project',
    sharedVocalFxBusesCapability: 'project',
    syncopatedArpeggioCapability: 'project',
    wholeProjectVibeMixCapability: 'project',
    creativeInterpretationCatalog: 'creative',
} as const satisfies Record<keyof LlmActionCapabilityData, 'request' | 'project' | 'creative'>;

type LocalCapabilityKey = keyof typeof LOCAL_CAPABILITY_KIND;

function isLocalCapabilityKey(key: string): key is LocalCapabilityKey {
    return Object.hasOwn(LOCAL_CAPABILITY_KIND, key);
}

/**
 * Where an entry stands: workflow capabilities the request asked for, then the workflow
 * capabilities the project offers, then the creative catalog, which a workflow covering the
 * request makes the wrong tool. With no workflow capability present the catalog stands alone.
 */
function capabilityTier(key: LocalCapabilityKey): number {
    const kind = LOCAL_CAPABILITY_KIND[key];
    if (kind === 'request') {
        return 0;
    }
    if (kind === 'project') {
        return 1;
    }
    return 2;
}

/**
 * The capability data a local message carries: whole entries, by tier and then cheapest first
 * within a tier, while the serialized object stays within the capability budget. An entry's cost
 * is what it adds to the serialized object, its key included, so cheapest first means a workflow
 * capability is never left out while a costlier one of its tier is kept. An entry that does not
 * fit the budget left after the entries kept before it is left out whole and named, never cut
 * mid-value, and the entries after it are still tried.
 */
function selectLocalCapabilities(capabilityData: LlmActionCapabilityData | undefined): {
    serialized: string;
    omitted: string[];
} {
    const capabilityKeys = Object.keys(LOCAL_CAPABILITY_KIND).filter(isLocalCapabilityKey);
    const present = capabilityKeys
        .flatMap((key) => {
            const value = capabilityData?.[key];
            return value === undefined ? [] : [{ key, value, cost: stableJson({ [key]: value }).length }];
        })
        .sort(
            (left, right) =>
                capabilityTier(left.key) - capabilityTier(right.key) ||
                left.cost - right.cost ||
                left.key.localeCompare(right.key)
        );
    const { kept, omitted } = fitWholeCapabilityEntries(present.map(({ key, value }) => [key, value] as const));
    return { serialized: stableJson(capabilityData === undefined ? null : kept), omitted };
}

function describeOmittedCapabilities(omitted: readonly string[]): string {
    return `capability_schemas.availableCapabilities leaves out ${omitted.join(', ')}, which did not fit what the ${String(MAX_AVAILABLE_CAPABILITIES_LENGTH)}-character capability budget had left after the entries it keeps; no tool returns capability data, so plan without ${omitted.length === 1 ? 'it' : 'them'} or ask for a hosted model.`;
}

function isRelevantLock(
    lock: NonNullable<ProjectContext['productionBrief']>['locks'][number],
    context: ProjectContext
): boolean {
    if (lock.scope.kind === 'project') {
        return true;
    }
    if (lock.scope.kind === 'track') {
        return lock.scope.trackId === context.selectedTrackId;
    }
    if (lock.scope.kind === 'object') {
        return (
            lock.scope.objectId === context.selectedTrackId ||
            lock.scope.objectId === context.selectedClipId ||
            context.selectedClipIds.includes(lock.scope.objectId)
        );
    }
    return false;
}

type BuildAgentContextInput = {
    fixedPolicy: string;
    prompt: string;
    context: ProjectContext;
    projectRevision?: string;
    run?: { grants: AgentRunGrants; budgets: AgentRunBudgets };
    receipts?: Array<{ id: string; summary: string }>;
    capabilitySchemas?: Array<{ name: string; schemaVersion: number }>;
    capabilityData?: LlmActionCapabilityData;
    validationFailures?: Array<{ code: string }>;
    /** Bounded diagnostic for the rejection a correction attempt must repair. */
    rejectionEvidence?: PlanningRejectionEvidence;
    measurements?: Array<{ name: string; value: number; unit: string }>;
    priorEvidence?: AgentContextEvidence | null;
};

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

/**
 * Keeps whole capability entries, in the order given, while the serialized object stays within
 * the capability budget. An entry that does not fit what the entries kept before it left is
 * named and left out whole, and the entries after it are still tried. Each copy of the
 * capability data passes its own order.
 */
function fitWholeCapabilityEntries(entries: ReadonlyArray<readonly [string, unknown]>): {
    kept: Record<string, unknown>;
    omitted: string[];
} {
    let kept: Record<string, unknown> = {};
    const omitted: string[] = [];
    for (const [key, value] of entries) {
        if (stableJson({ ...kept, [key]: value }).length > MAX_AVAILABLE_CAPABILITIES_LENGTH) {
            omitted.push(key);
            continue;
        }
        kept = { ...kept, [key]: value };
    }
    return { kept, omitted };
}

/**
 * Selects whole capability entries for the hosted copy: under budget the data serializes
 * exactly as before, over budget each entry is kept whole only while the running total fits
 * the budget, in the data's own entry order, and every dropped entry is named. An entry
 * larger than the whole budget is omitted whole, so the result parses even when it is empty.
 */
function buildAvailableCapabilities(capabilityData: LlmActionCapabilityData | undefined): {
    value: string;
    omittedCapabilityNames: string[];
} {
    const full = stableJson(capabilityData ?? null);
    if (full.length <= MAX_AVAILABLE_CAPABILITIES_LENGTH) {
        return { value: full, omittedCapabilityNames: [] };
    }
    const presentEntries = Object.entries(capabilityData ?? {}).filter(([, entry]) => entry !== undefined);
    const { kept, omitted } = fitWholeCapabilityEntries(presentEntries);
    return { value: stableJson(kept), omittedCapabilityNames: omitted };
}

function boundedTo(value: string, maxLength: number): { value: string; truncated: boolean } {
    return { value: value.slice(0, maxLength), truncated: value.length > maxLength };
}

function boundedString(value: string): { value: string; truncated: boolean } {
    return boundedTo(value, MAX_IMPORTED_STRING_LENGTH);
}

function boundedCanonicalRole(role: ProjectContext['tracks'][number]['canonicalRole']) {
    if (!role) {
        return null;
    }
    return {
        role: boundedString(role.role).value,
        source: boundedString(role.source).value,
        evidence: boundedString(role.evidence).value,
        contentRevision: role.contentRevision?.slice(0, MAX_IMPORTED_STRING_LENGTH),
    };
}

function buildProviderClip(clip: ProjectContext['tracks'][number]['clips'][number]) {
    return {
        id: clip.id,
        name: { trust: 'untrusted_imported_string' as const, ...boundedString(clip.name) },
        type: clip.type,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        ...(clip.gain === undefined ? {} : { gain: clip.gain, gainDb: clip.gainDb ?? toLevelDb(clip.gain) }),
        locked: clip.locked ?? false,
        muted: clip.muted ?? false,
    };
}

function buildProviderTrack(track: ProjectContext['tracks'][number]) {
    const clips = track.clips.slice(0, MAX_SELECTED_CLIPS).map(buildProviderClip);
    const sends = (track.sends ?? []).slice(0, MAX_CONTEXT_TARGETS).map((send) => ({
        busId: send.busId,
        level: send.level,
        levelDb: send.levelDb ?? toLevelDb(send.level),
        preFader: send.preFader,
    }));
    return {
        id: track.id,
        name: { trust: 'untrusted_imported_string' as const, ...boundedString(track.name) },
        kind: track.kind,
        canonicalRole: boundedCanonicalRole(track.canonicalRole),
        frozen: track.frozen ?? false,
        gain: track.gain,
        gainDb: track.gainDb ?? toLevelDb(track.gain),
        clips,
        omittedClipCount: Math.max(0, track.clips.length - clips.length),
        sends,
        omittedSendCount: Math.max(0, (track.sends?.length ?? 0) - sends.length),
    };
}

function buildProviderAutomationLane(lane: NonNullable<ProjectContext['automationLanes']>[number]) {
    return {
        id: lane.id,
        trackId: lane.trackId,
        ...(lane.clipId === undefined ? {} : { clipId: lane.clipId }),
        parameterId: lane.parameterId,
        name: { trust: 'untrusted_imported_string' as const, ...boundedString(lane.name) },
        enabled: lane.enabled,
        minValue: lane.minValue,
        maxValue: lane.maxValue,
        ...(lane.minValueDb === undefined ? {} : { minValueDb: lane.minValueDb }),
        ...(lane.maxValueDb === undefined ? {} : { maxValueDb: lane.maxValueDb }),
    };
}

function buildProjectData(context: ProjectContext) {
    const selectedSource = context.tracks.find((track) => track.id === context.selectedTrackId) ?? null;
    const selectedTrack = selectedSource === null ? null : buildProviderTrack(selectedSource);
    const selectableTargets = context.tracks.slice(0, MAX_CONTEXT_TARGETS).map(buildProviderTrack);
    const automationLanes = (context.automationLanes ?? [])
        .slice(0, MAX_CONTEXT_TARGETS)
        .map(buildProviderAutomationLane);
    const sections = (context.sections ?? []).slice(0, MAX_CONTEXT_TARGETS).map((section) => ({
        id: section.id,
        name: { trust: 'untrusted_imported_string' as const, ...boundedString(section.name) },
        startBeat: section.startBeat,
        endBeat: section.endBeat,
    }));
    return {
        tempo: context.tempo,
        timeSignature: context.timeSignature,
        // Stated once for the whole payload: every decibel figure below is read
        // against this window, and a reader that cannot see the window cannot
        // tell a level near the ceiling from one with room left.
        levelLaw: PROJECT_CONTEXT_LEVEL_LAW,
        masterGain: context.masterGain,
        masterGainDb: context.masterGainDb ?? toLevelDb(context.masterGain),
        selectedTrack,
        selectableTargets,
        automationLanes,
        omittedAutomationLaneCount: Math.max(0, (context.automationLanes?.length ?? 0) - automationLanes.length),
        sections,
        targetCount: context.tracks.length,
        truncated:
            context.tracks.length > selectableTargets.length ||
            (context.sections?.length ?? 0) > sections.length ||
            (context.automationLanes?.length ?? 0) > automationLanes.length ||
            selectableTargets.some((target) => target.omittedClipCount > 0 || target.omittedSendCount > 0) ||
            (selectedTrack !== null && (selectedTrack.omittedClipCount > 0 || selectedTrack.omittedSendCount > 0)),
    };
}

function snapshotProjectData(projectData: ReturnType<typeof buildProjectData>) {
    const selectedTrack = projectData.selectedTrack
        ? { id: projectData.selectedTrack.id, digest: digest(projectData.selectedTrack) }
        : null;
    const selectableTargets = projectData.selectableTargets.map((target) => ({
        id: target.id,
        digest: digest(target),
    }));
    const sections = projectData.sections.map((section) => ({
        id: section.id,
        digest: digest(section),
    }));
    const automationLanes = projectData.automationLanes.map((lane) => ({ id: lane.id, digest: digest(lane) }));
    return {
        identity: digest({
            tempo: projectData.tempo,
            timeSignature: projectData.timeSignature,
            levelLaw: projectData.levelLaw,
            masterGain: projectData.masterGain,
            masterGainDb: projectData.masterGainDb,
            selectedTrack,
            selectableTargets,
            automationLanes,
            sections,
            targetCount: projectData.targetCount,
            truncated: projectData.truncated,
        }),
        tempo: projectData.tempo,
        timeSignature: projectData.timeSignature,
        masterGain: projectData.masterGain,
        masterGainDb: projectData.masterGainDb,
        selectedTrack,
        selectableTargets,
        automationLanes,
        sections,
        targetCount: projectData.targetCount,
        truncated: projectData.truncated,
    };
}

// Section identity stays in the stored evidence snapshot for delta diffing. The
// provider-bound payload grounds sections by name and beat range only, so raw
// internal section ids never enter a provider request.
function toProviderBoundSection(section: ReturnType<typeof buildProjectData>['sections'][number]) {
    return { name: section.name, startBeat: section.startBeat, endBeat: section.endBeat };
}

function buildRevisionPayload(input: {
    projectData: ReturnType<typeof buildProjectData>;
    snapshot: AgentContextEvidence['snapshot'];
    priorEvidence?: AgentContextEvidence | null;
    revision: string | null;
}) {
    const priorSnapshot = input.priorEvidence?.snapshot;
    const compatiblePrior =
        input.priorEvidence?.schemaVersion === AGENT_CONTEXT_SCHEMA_VERSION &&
        input.priorEvidence.revision !== null &&
        input.priorEvidence.revision !== input.revision &&
        priorSnapshot !== undefined &&
        !priorSnapshot.truncated &&
        !input.snapshot.truncated;
    if (!compatiblePrior) {
        return {
            delta: { mode: 'full' as const, baseRevision: null, currentRevision: input.revision },
            projectPayload: { ...input.projectData, sections: input.projectData.sections.map(toProviderBoundSection) },
        };
    }
    const priorTargets = new Map(priorSnapshot.selectableTargets.map((target) => [target.id, target.digest]));
    const changedTargets = input.projectData.selectableTargets.filter(
        (target) => priorTargets.get(target.id) !== digest(target)
    );
    const currentTargetIds = new Set(input.snapshot.selectableTargets.map((target) => target.id));
    const removedTargetIds = priorSnapshot.selectableTargets
        .filter((target) => !currentTargetIds.has(target.id))
        .map((target) => target.id);
    const priorAutomationLanes = new Map(priorSnapshot.automationLanes.map((lane) => [lane.id, lane.digest]));
    const changedAutomationLanes = input.projectData.automationLanes.filter(
        (lane) => priorAutomationLanes.get(lane.id) !== digest(lane)
    );
    const currentAutomationLaneIds = new Set(input.snapshot.automationLanes.map((lane) => lane.id));
    const removedAutomationLaneIds = priorSnapshot.automationLanes
        .filter((lane) => !currentAutomationLaneIds.has(lane.id))
        .map((lane) => lane.id);
    const priorSections = new Map((priorSnapshot.sections ?? []).map((section) => [section.id, section.digest]));
    const changedSections = input.projectData.sections.filter(
        (section) => priorSections.get(section.id) !== digest(section)
    );
    const currentSectionIds = new Set((input.snapshot.sections ?? []).map((section) => section.id));
    const removedSectionIds = (priorSnapshot.sections ?? [])
        .filter((section) => !currentSectionIds.has(section.id))
        .map((section) => section.id);
    return {
        delta: {
            mode: 'delta' as const,
            baseRevision: input.priorEvidence!.revision,
            currentRevision: input.revision,
        },
        projectPayload: {
            // The law is a constant, not project state: a delta that omitted it
            // would leave a correction round reading levels with no window.
            levelLaw: input.projectData.levelLaw,
            masterGain: input.projectData.masterGain,
            masterGainDb: input.projectData.masterGainDb,
            ...(priorSnapshot.tempo === input.snapshot.tempo ? {} : { tempo: input.projectData.tempo }),
            ...(stableJson(priorSnapshot.timeSignature) === stableJson(input.snapshot.timeSignature)
                ? {}
                : { timeSignature: input.projectData.timeSignature }),
            ...(priorSnapshot.selectedTrack?.digest === input.snapshot.selectedTrack?.digest
                ? {}
                : { selectedTrack: input.projectData.selectedTrack }),
            ...(changedTargets.length === 0 ? {} : { selectableTargets: changedTargets }),
            ...(removedTargetIds.length === 0 ? {} : { removedTargetIds }),
            ...(changedAutomationLanes.length === 0 ? {} : { automationLanes: changedAutomationLanes }),
            ...(removedAutomationLaneIds.length === 0 ? {} : { removedAutomationLaneIds }),
            ...(changedSections.length === 0 ? {} : { sections: changedSections.map(toProviderBoundSection) }),
            ...(removedSectionIds.length === 0 ? {} : { removedSectionIds }),
        },
    };
}

/**
 * The planning context for one turn, in two renderings of the same evidence. `message` is what a
 * hosted provider reads. `localMessage` is what the local model reads inside its context window:
 * the same grounding sections, without the fixed policy and tool names its system prompt already
 * carries or the selected track's duplicate, closed by the local project context, which states only
 * what those sections leave out.
 */
export function buildAgentContext(input: BuildAgentContextInput): {
    authorityComplete: boolean;
    message: string;
    localMessage: string;
    evidence: AgentContextEvidence;
} {
    const revision = input.projectRevision ?? null;
    const projectData = buildProjectData(input.context);
    const snapshot = snapshotProjectData(projectData);
    const revisionPayload = buildRevisionPayload({
        projectData,
        snapshot,
        priorEvidence: input.priorEvidence,
        revision,
    });
    const validationFailures = (input.validationFailures ?? []).slice(-MAX_VALIDATION_FAILURES);
    const retainedReceipts = (input.receipts ?? []).slice(-MAX_RECEIPTS);
    const receiptSummaryBudget =
        retainedReceipts.length === 0
            ? MAX_RECEIPT_EVIDENCE_LENGTH
            : Math.floor(MAX_RECEIPT_EVIDENCE_LENGTH / retainedReceipts.length);
    const receipts = retainedReceipts.map((receipt) => ({
        id: boundedString(receipt.id).value,
        summary: boundedTo(receipt.summary, receiptSummaryBudget),
    }));
    const capabilitySchemas = (input.capabilitySchemas ?? []).slice(0, MAX_CONTEXT_TARGETS).map((schema) => ({
        name: boundedString(schema.name).value,
        schemaVersion: schema.schemaVersion,
    }));
    const hostedCapabilities = buildAvailableCapabilities(input.capabilityData);
    const measurements = (input.measurements ?? []).slice(-MAX_MEASUREMENTS).map((measurement) => ({
        name: boundedString(measurement.name).value,
        value: measurement.value,
        unit: boundedString(measurement.unit).value,
    }));
    const validationFailureEvidence = {
        total: input.validationFailures?.length ?? 0,
        retained: validationFailures.length,
        omitted: Math.max(0, (input.validationFailures?.length ?? 0) - validationFailures.length),
    };
    // The correction diagnostic: which proposal item failed, what the app
    // expects, and — trust-labeled and bounded — the fragment that failed.
    // Absent codes like `agent.resolution` cannot say this.
    const rejectionEvidenceItem = input.rejectionEvidence
        ? (() => {
              const evidence = input.rejectionEvidence;
              return {
                  kind: evidence.kind,
                  ...(evidence.itemId === undefined ? {} : { itemId: boundedString(evidence.itemId).value }),
                  ...(evidence.command === undefined
                      ? {}
                      : {
                            command: {
                                index: evidence.command.index,
                                name: boundedString(evidence.command.name).value,
                            },
                        }),
                  ...(evidence.argumentPath === undefined
                      ? {}
                      : { argumentPath: boundedString(evidence.argumentPath).value }),
                  reason: boundedString(evidence.reason).value,
                  ...(evidence.resolution === undefined ? {} : { resolution: evidence.resolution }),
                  ...(evidence.candidateIds === undefined
                      ? {}
                      : {
                            candidateIds: evidence.candidateIds
                                .slice(0, MAX_REJECTION_CANDIDATES)
                                .map((candidateId) => boundedString(candidateId).value),
                        }),
                  ...(evidence.rejectedFragment === undefined
                      ? {}
                      : {
                            rejectedFragment: {
                                trust: 'untrusted_provider_output' as const,
                                ...boundedTo(evidence.rejectedFragment, MAX_REJECTION_FRAGMENT_LENGTH),
                            },
                        }),
              };
          })()
        : null;
    const evidence: AgentContextEvidence = {
        schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
        revision,
        selection: {
            trackId: input.context.selectedTrackId,
            clipId: input.context.selectedClipId,
            clipIds: [...input.context.selectedClipIds],
        },
        grants: input.run ? structuredClone(input.run.grants) : null,
        budgets: input.run ? structuredClone(input.run.budgets) : null,
        included: {
            receiptCount: receipts.length,
            capabilitySchemaCount: capabilitySchemas.length,
            validationFailures: validationFailureEvidence,
            measurementCount: measurements.length,
            trackCount: input.context.tracks.length,
        },
        snapshot,
        delta: revisionPayload.delta,
    };
    const productionBrief = input.context.productionBrief
        ? {
              id: input.context.productionBrief.id,
              revision: input.context.productionBrief.revision,
              vision: input.context.productionBrief.vision && boundedString(input.context.productionBrief.vision),
              locks: [...input.context.productionBrief.locks]
                  .sort(
                      (left, right) =>
                          Number(isRelevantLock(right, input.context)) - Number(isRelevantLock(left, input.context))
                  )
                  .slice(0, MAX_CONTEXT_TARGETS)
                  .map((lock) => ({
                      id: lock.id,
                      scope: lock.scope,
                      statement: boundedString(lock.statement),
                  })),
              omittedLockCount: Math.max(0, input.context.productionBrief.locks.length - MAX_CONTEXT_TARGETS),
              incompleteRelevantAuthority:
                  input.context.productionBrief.locks.filter((lock) => isRelevantLock(lock, input.context)).length >
                  MAX_CONTEXT_TARGETS,
          }
        : null;

    const leadingSections = [
        `run_authority:\n${stableJson({ grants: evidence.grants, budgets: evidence.budgets })}`,
        `user_request:\n${stableJson({ trust: 'untrusted_user_string', ...boundedString(input.prompt) })}`,
        `production_brief_and_locks:\n${stableJson({ trust: 'untrusted_project_data', value: productionBrief })}`,
        `revision_and_selection:\n${stableJson({ revision, selection: evidence.selection, delta: evidence.delta })}`,
        `relevant_evidence:\n${stableJson({ trust: 'untrusted_project_data', receipts, omitted: Math.max(0, (input.receipts?.length ?? 0) - receipts.length) })}`,
    ];
    const trailingSections = [
        `validation_failures:\n${stableJson({ evidence: validationFailureEvidence, items: validationFailures.map((failure) => ({ code: boundedString(failure.code) })), ...(rejectionEvidenceItem === null ? {} : { correction: rejectionEvidenceItem }) })}`,
        `measurements:\n${stableJson({ items: measurements, omitted: Math.max(0, (input.measurements?.length ?? 0) - measurements.length) })}`,
    ];
    const hostedSections = [
        ...leadingSections,
        `capability_schemas:\n${stableJson({ schemas: capabilitySchemas, omitted: Math.max(0, (input.capabilitySchemas?.length ?? 0) - capabilitySchemas.length), trust: 'untrusted_project_data', availableCapabilities: hostedCapabilities.value, ...(hostedCapabilities.omittedCapabilityNames.length === 0 ? {} : { omittedCapabilityNames: hostedCapabilities.omittedCapabilityNames }) })}`,
        ...trailingSections,
        `untrusted_project_data:\n${stableJson({ snapshotIdentity: snapshot.identity, mode: evidence.delta.mode, data: revisionPayload.projectPayload })}`,
    ].join('\n\n');
    // The local message carries every section a model grounds targets and capabilities in. It
    // leaves out three things the local model reads elsewhere: the fixed policy and the tool names,
    // which its system prompt already spells, and the selected track's second copy, which repeats
    // a selectable target the selection already names by id. It carries the capability data as
    // whole entries and counts the sections the project data left out, and closes with every
    // omission it made and where to read the rest, if anywhere.
    const { selectedTrack: _selectedTrackCopy, ...localProjectPayload } = revisionPayload.projectPayload;
    const localCapabilities = selectLocalCapabilities(input.capabilityData);
    const contextOmissions = [
        projectData.truncated ? PROJECT_SECTION_OMISSIONS : null,
        localCapabilities.omitted.length === 0 ? null : describeOmittedCapabilities(localCapabilities.omitted),
    ].filter((omission) => omission !== null);
    const localSections = [
        ...leadingSections,
        `capability_schemas:\n${stableJson({ trust: 'untrusted_project_data', availableCapabilities: localCapabilities.serialized })}`,
        ...trailingSections,
        `untrusted_project_data:\n${stableJson({
            snapshotIdentity: snapshot.identity,
            mode: evidence.delta.mode,
            // The hosted payload's bytes are fixed and its project context lists every section, so
            // only the local payload counts the sections it left out.
            data: {
                ...localProjectPayload,
                omittedSectionCount: Math.max(0, (input.context.sections?.length ?? 0) - projectData.sections.length),
            },
        })}`,
        `context_omissions:\n${stableJson(contextOmissions)}`,
    ].join('\n\n');
    // A delta turn carries no project context; a full turn closes with it, and the local profile
    // of it states only what the sections above leave out.
    const projectContextMessage = (profile: LlmActionMessageProfile): string =>
        evidence.delta.mode === 'delta'
            ? ''
            : `\n\n${buildLlmActionUserMessage({
                  prompt: input.prompt,
                  context: input.context,
                  projectRevision: input.projectRevision,
                  profile,
                  ...input.capabilityData,
              })}`;

    return {
        authorityComplete: productionBrief?.incompleteRelevantAuthority !== true,
        evidence,
        message: `fixed_policy:\n${input.fixedPolicy}\n\n${hostedSections}${projectContextMessage('hosted')}`,
        localMessage: `${localSections}${projectContextMessage('local')}`,
    };
}
