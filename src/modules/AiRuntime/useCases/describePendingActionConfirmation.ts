import { getPluginById } from '#/modules/Arrangement/useCases';
import { getAppActionExecutionPolicy } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';
import { type WholeProjectVibeMixPlan } from '../models/WholeProjectVibeMixPlan';
import { type WorkflowCapabilityId } from '../models/WorkflowCapability';

import { getArticulationTransferPromptScope } from './agentReference/getArticulationTransferPromptScope';
import { getBackingVocalPlatePromptScope } from './agentReference/getBackingVocalPlatePromptScope';
import { getBassProcessingCopyPromptScope } from './agentReference/getBassProcessingCopyPromptScope';
import { getBulkDeviceInsertionTrackScope } from './agentReference/getBulkDeviceInsertionTrackScope';
import { getDeviceParameterPromptScope } from './agentReference/getDeviceParameterPromptScope';
import { getDrumPreviewBranchesPromptScope } from './agentReference/getDrumPreviewBranchesPromptScope';
import { getDrumRenderComparisonPromptScope } from './agentReference/getDrumRenderComparisonPromptScope';
import { getDrumRoutingPromptScope } from './agentReference/getDrumRoutingPromptScope';
import { getMidiOverlapTransformPromptScope } from './agentReference/getMidiOverlapTransformPromptScope';
import { getMutedEmptyTrackDeletionScope } from './agentReference/getMutedEmptyTrackDeletionScope';
import { getSharedVocalFxBusesPromptScope } from './agentReference/getSharedVocalFxBusesPromptScope';
import { getSidechainRoutingPromptScope } from './agentReference/getSidechainRoutingPromptScope';
import { getSyncopatedArpeggioPromptScope } from './agentReference/getSyncopatedArpeggioPromptScope';
import { describePlannedAction } from './describePlannedAction';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';

type DescribePendingActionConfirmationInput = {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan;
    workflowCapabilityId?: WorkflowCapabilityId;
};

const riskRank = {
    'read-only': 0,
    'bounded-reversible': 1,
    'broad-reversible': 2,
    'destructive-reversible': 3,
    'authority-sensitive': 4,
    'external-effect': 5,
    unclassified: 6,
} as const;

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function formatParameterValue(value: number, unit: string): string {
    if (unit === ':1') {
        return `${String(value)}:1`;
    }
    if (unit) {
        return `${String(value)} ${unit}`;
    }
    return String(value);
}

function formatDescriptorParameterValue(value: number, unit: string, choices?: readonly string[]): string {
    const choice = Number.isInteger(value) ? choices?.[value] : undefined;
    if (choice) {
        return `"${choice}" (${String(value)})`;
    }
    return formatParameterValue(value, unit);
}

function formatDecibelsFromGain(value: number): string {
    if (value <= 0) {
        return '-∞ dB';
    }
    const decibels = 20 * Math.log10(value);
    const rounded = Math.round(decibels * 100) / 100;
    return `${String(rounded)} dB`;
}

function resolveActionTrackName(trackId: string, actions: readonly AppAction[], context: ProjectContext): string {
    const existing = context.tracks.find((track) => track.id === trackId);
    if (existing) {
        return existing.name;
    }
    const created = actions.find((action) => action.type === 'createBus' && action.payload.busId === trackId);
    return created?.type === 'createBus' ? created.payload.name : trackId;
}

function resolveActionDeviceName(deviceId: string, actions: readonly AppAction[], context: ProjectContext): string {
    const existing = context.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId);
    if (existing) {
        return existing.name ?? existing.type;
    }
    const created = actions.find((action) => action.type === 'addDevice' && action.payload.deviceId === deviceId);
    if (created?.type === 'addDevice') {
        return getPluginById(created.payload.deviceType)?.name ?? created.payload.deviceType;
    }
    return deviceId;
}

function describeDeviceParameterAction(
    action: Extract<AppAction, { type: 'setDeviceParameter' }>,
    context: ProjectContext
): string | null {
    const matchingTracks = context.tracks.filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    let owner = matchingTracks.length === 1 ? matchingTracks[0] : undefined;
    if (action.payload.expectedTrackId !== undefined) {
        owner = matchingTracks.find((candidate) => candidate.id === action.payload.expectedTrackId);
    }
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    const parameter = device?.parameters?.find((candidate) => candidate.id === action.payload.paramId);
    const previousValue = action.payload.expectedValue ?? parameter?.value;
    if (!owner || !device || !parameter || previousValue === undefined) {
        return null;
    }
    const deviceName = device.name ?? device.type;
    return `Set "${owner.name}" (${owner.id}) device "${deviceName}" (${device.id}, ${device.type}) parameter "${parameter.name}" (${parameter.id}) from ${formatParameterValue(previousValue, parameter.unit)} to ${formatParameterValue(action.payload.value, parameter.unit)}`;
}

function getProtectedUnchangedTracks(
    prompt: string,
    context: ProjectContext,
    actions: readonly AppAction[],
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan,
    workflowCapabilityId?: WorkflowCapabilityId
): Array<{ id: string; name: string }> {
    const protectedScopes = [
        ...prompt.matchAll(/\b(?:leave|leaving|keep|keeping|preserve|preserving)\s+(.+?)\s+unchanged\b/giu),
    ].flatMap((match) => (match[1] ? [normalizeText(match[1])] : []));
    const excludedFrozenTrackIds = new Set(
        getBulkDeviceInsertionTrackScope(prompt, context)?.excludedFrozenTrackIds ?? []
    );
    const structurallyProtectedTrackIds = new Set(
        getMutedEmptyTrackDeletionScope(prompt, context)?.protectedTrackIds ?? []
    );
    const protectedTracks = context.tracks.filter((track) => {
        const normalizedName = normalizeText(track.name);
        return (
            excludedFrozenTrackIds.has(track.id) ||
            structurallyProtectedTrackIds.has(track.id) ||
            protectedScopes.some((scope) => ` ${scope} `.includes(` ${normalizedName} `))
        );
    });
    const deviceParameterScope = getDeviceParameterPromptScope(prompt, context);
    let protectedParameters: Array<{ id: string; name: string }> = [];
    if (deviceParameterScope) {
        const deviceName = deviceParameterScope.device.name ?? deviceParameterScope.device.type;
        protectedParameters = deviceParameterScope.protectedParameters.map((parameter) => ({
            id: `${deviceParameterScope.device.id}:${parameter.id}`,
            name: `${deviceParameterScope.track.name} ${deviceName} ${parameter.name} = ${String(parameter.value)}${parameter.unit === ':1' ? ':1' : ` ${parameter.unit}`}`,
        }));
    }
    const planProtections = wholeProjectVibeMixPlan?.globalConstraints.map(({ id, name }) => ({ id, name })) ?? [];
    const drumRoutingScope = workflowCapabilityId === 'drum-routing' ? getDrumRoutingPromptScope(context) : null;
    const drumRoutingProtections =
        drumRoutingScope?.status === 'request'
            ? [{ id: drumRoutingScope.protectedReturnId, name: drumRoutingScope.protectedReturnName }]
            : [];
    const drumRenderComparisonScope =
        workflowCapabilityId === 'drum-render-comparison' ? getDrumRenderComparisonPromptScope(context) : null;
    const drumRenderComparisonProtections =
        drumRenderComparisonScope?.status === 'request' ? drumRenderComparisonScope.protectedObjects : [];
    const drumPreviewBranchesScope =
        workflowCapabilityId === 'drum-preview-branches' ? getDrumPreviewBranchesPromptScope(context) : null;
    const drumPreviewBranchProtections =
        drumPreviewBranchesScope?.status === 'request' ? drumPreviewBranchesScope.protectedObjects : [];
    const sidechainRoutingScope = getSidechainRoutingPromptScope(prompt, context);
    const sidechainRoutingProtections =
        sidechainRoutingScope.status === 'request'
            ? sidechainRoutingScope.protectedTargets.map(({ id, name }) => ({ id, name }))
            : [];
    const sharedVocalFxBusesScope =
        workflowCapabilityId === 'shared-vocal-fx-buses' ? getSharedVocalFxBusesPromptScope(context) : null;
    const sharedVocalFxBusesProtections =
        sharedVocalFxBusesScope?.status === 'request' ? sharedVocalFxBusesScope.protectedObjects : [];
    const articulationTransferScope =
        workflowCapabilityId === 'articulation-transfer' ? getArticulationTransferPromptScope(context) : null;
    const articulationProtections =
        articulationTransferScope?.status === 'request'
            ? [
                  ...articulationTransferScope.protectedClipIds.map((clipId) => ({
                      id: clipId,
                      name:
                          context.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)?.name ??
                          clipId,
                  })),
                  ...articulationTransferScope.clipPairs.map((pair) => ({
                      id: `${pair.targetClipId}:non-articulation`,
                      name: `${pair.targetClipName} pitches, velocities, timing, and expression`,
                  })),
              ]
            : [];
    const backingVocalPlateScope =
        workflowCapabilityId === 'backing-vocal-plate' ? getBackingVocalPlatePromptScope(context) : null;
    const backingVocalPlateProtections =
        backingVocalPlateScope?.status === 'request' ? backingVocalPlateScope.protectedObjects : [];
    const bassProcessingCopyScope =
        workflowCapabilityId === 'bass-processing-copy' ? getBassProcessingCopyPromptScope(context) : null;
    const bassProcessingCopyProtections =
        bassProcessingCopyScope?.status === 'request' ? bassProcessingCopyScope.protectedObjects : [];
    const midiOverlapTransformScope =
        workflowCapabilityId === 'midi-overlap-shortening' ? getMidiOverlapTransformPromptScope(context) : null;
    const midiOverlapTransformProtections =
        midiOverlapTransformScope?.status === 'request' ? midiOverlapTransformScope.protectedObjects : [];
    const syncopatedArpeggioScope =
        workflowCapabilityId === 'syncopated-arpeggio' ? getSyncopatedArpeggioPromptScope(context) : null;
    const syncopatedArpeggioProtections =
        syncopatedArpeggioScope?.status === 'request' ? syncopatedArpeggioScope.protectedObjects : [];
    const protections = [
        ...(actions.some((action) => action.type === 'importStemSet')
            ? context.tracks.map(({ id, name }) => ({ id, name }))
            : []),
        ...protectedTracks.map(({ id, name }) => ({ id, name })),
        ...protectedParameters,
        ...planProtections,
        ...drumRoutingProtections,
        ...drumRenderComparisonProtections,
        ...drumPreviewBranchProtections,
        ...sidechainRoutingProtections,
        ...sharedVocalFxBusesProtections,
        ...articulationProtections,
        ...backingVocalPlateProtections,
        ...bassProcessingCopyProtections,
        ...midiOverlapTransformProtections,
        ...syncopatedArpeggioProtections,
    ];
    return [...new Map(protections.map((protection) => [protection.id, protection])).values()];
}

function describeWholeProjectVibeMixPlan(plan: WholeProjectVibeMixPlan): string {
    let previous = 'none';
    if (plan.sectionMap.previous) {
        previous = `"${plan.sectionMap.previous.name}" (${plan.sectionMap.previous.id})`;
    }
    let next = 'none';
    if (plan.sectionMap.next) {
        next = `"${plan.sectionMap.next.name}" (${plan.sectionMap.next.id})`;
    }
    const roles = plan.trackRoles.map((track) => `- ${track.role}: "${track.trackName}" (${track.trackId})`).join('\n');
    const decisions = plan.acceptedDecisions.map((decision) => `- ${decision}`).join('\n');
    return `Whole-project plan (schema ${String(plan.schemaVersion)}, revision ${plan.baseRevision}):\n\nProduction vision: ${plan.productionVision}\n\nSection map: target "${plan.sectionMap.target.name}" (${plan.sectionMap.target.id}) beats ${String(plan.sectionMap.target.startBeat)}–${String(plan.sectionMap.target.endBeat)}; previous ${previous}; next ${next}.\n\nTrack roles:\n${roles}\n\nDynamic trajectory: preserve before beat ${String(plan.dynamicTrajectory.startBeat)}, lift impact buses by ${String(plan.dynamicTrajectory.gainDb)} dB through beat ${String(plan.dynamicTrajectory.endBeat)}, then restore current gain.\n\nMix strategy: routing ${plan.strategy.routing}; devices ${plan.strategy.devices}; automation ${plan.strategy.automation}\n\nAccepted decisions:\n${decisions}`;
}

function describeExactAction(action: AppAction, actions: readonly AppAction[], context: ProjectContext): string {
    if (action.type === 'importStemSet') {
        const stems = action.payload.stems
            .map((stem) => {
                let pan = 'center';
                if (stem.trackPan < 0) {
                    pan = `${String(stem.trackPan)} pan`;
                } else if (stem.trackPan > 0) {
                    pan = `+${String(stem.trackPan)} pan`;
                }
                return `${stem.trackName} (${stem.role}, ${String(stem.trackGain)} gain, ${pan})`;
            })
            .join(', ');
        const sourceTempos = [...new Set(action.payload.stems.map((stem) => stem.sourceTempo))];
        const tempoSource =
            sourceTempos.length === 1
                ? `every ${String(sourceTempos[0])} BPM source`
                : `sources at ${sourceTempos.map(String).join('/')} BPM`;
        return `Import ${String(action.payload.stems.length)} stems into folder "${action.payload.groupName}" at ${String(action.payload.projectTempo)} BPM: ${stems}; time-stretch ${tempoSource} to ${String(action.payload.projectTempo)} BPM`;
    }
    if (
        action.type === 'addAdjustmentRegion' &&
        action.payload.expectedLayer &&
        action.payload.sourceRegionId &&
        action.payload.sourceSection &&
        action.payload.targetSection
    ) {
        const sourceRegion = action.payload.expectedLayer.regions.find(
            (region) => region.id === action.payload.sourceRegionId
        );
        const tracks = (action.payload.expectedTracks ?? [])
            .map((track) => `"${track.trackName}" (${track.trackId})`)
            .join(', ');
        if (sourceRegion) {
            return `Copy ${action.payload.expectedLayer.effectType} layer "${action.payload.expectedLayer.name}" (${action.payload.layerId}) on ${tracks} from "${action.payload.sourceSection.name}" (${action.payload.sourceSection.id}) region ${sourceRegion.id} beats ${String(sourceRegion.startBeat)}–${String(sourceRegion.endBeat)} to "${action.payload.targetSection.name}" (${action.payload.targetSection.id}) as ${action.payload.regionId ?? 'application-assigned region'} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}, blend ${String(action.payload.blend ?? 1)}, fades ${String(action.payload.fadeInBeats ?? 0.25)}/${String(action.payload.fadeOutBeats ?? 0.25)} beats; preserve layer parameters and mix`;
        }
    }
    if (action.type === 'removeDevice') {
        const owner = context.tracks.find((track) =>
            track.devices.some((device) => device.id === action.payload.deviceId)
        );
        const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
        if (owner && device) {
            return `Remove device "${device.name ?? device.type}" (${device.id}, ${device.type}) from "${owner.name}" (${owner.id})`;
        }
    }
    if (action.type === 'createBus' && action.payload.busId) {
        const gain = action.payload.initialGain === 1 ? ' at unity gain' : '';
        return `Create bus "${action.payload.name}" (${action.payload.busId})${gain}`;
    }
    if (action.type === 'addDevice' && action.payload.deviceId) {
        const trackName = resolveActionTrackName(action.payload.trackId, actions, context);
        const deviceName = getPluginById(action.payload.deviceType)?.name ?? action.payload.deviceType;
        let anchor = 'at the end of the chain';
        if (action.payload.afterDeviceId) {
            const anchorName = resolveActionDeviceName(action.payload.afterDeviceId, actions, context);
            anchor = `after "${anchorName}" (${action.payload.afterDeviceId})`;
        }
        return `Insert "${deviceName}" (${action.payload.deviceId}, ${action.payload.deviceType}) on "${trackName}" (${action.payload.trackId}) ${anchor}`;
    }
    if (action.type === 'setTrackOutput') {
        const source = context.tracks.find((track) => track.id === action.payload.trackId);
        const existingTarget = context.tracks.find((track) => track.id === action.payload.outputId);
        const createdTarget = actions.find(
            (candidate) => candidate.type === 'createBus' && candidate.payload.busId === action.payload.outputId
        );
        const targetName =
            existingTarget?.name ?? (createdTarget?.type === 'createBus' ? createdTarget.payload.name : null);
        if (source && targetName) {
            const previousOutput = action.payload.expectedOutputId ?? source.outputId ?? 'master';
            return `Route "${source.name}" (${source.id}) from ${previousOutput} to "${targetName}" (${action.payload.outputId})`;
        }
    }
    if (action.type === 'setDeviceParameter') {
        const description = describeDeviceParameterAction(action, context);
        if (description) {
            return description;
        }
        const createdDevice = actions.find(
            (candidate) => candidate.type === 'addDevice' && candidate.payload.deviceId === action.payload.deviceId
        );
        if (createdDevice?.type === 'addDevice' && action.payload.expectedValue !== undefined) {
            const trackName = resolveActionTrackName(createdDevice.payload.trackId, actions, context);
            const descriptor = getPluginById(createdDevice.payload.deviceType);
            const parameter = descriptor?.parameters.find((candidate) => candidate.id === action.payload.paramId);
            if (parameter) {
                return `Set "${trackName}" (${createdDevice.payload.trackId}) device "${descriptor?.name ?? createdDevice.payload.deviceType}" (${action.payload.deviceId}, ${createdDevice.payload.deviceType}) parameter "${parameter.name}" (${parameter.id}) from ${formatDescriptorParameterValue(action.payload.expectedValue, parameter.unit, parameter.choices)} to ${formatDescriptorParameterValue(action.payload.value, parameter.unit, parameter.choices)}`;
            }
        }
    }
    if (action.type === 'addSend') {
        const sourceName = resolveActionTrackName(action.payload.trackId, actions, context);
        const busName = resolveActionTrackName(action.payload.busId, actions, context);
        const tap = action.payload.preFader === true ? 'pre-fader' : 'post-fader';
        return `Create ${tap} send from "${sourceName}" (${action.payload.trackId}) to "${busName}" (${action.payload.busId}) at ${formatDecibelsFromGain(action.payload.level)}`;
    }
    if (action.type === 'setTrackGain') {
        const createdTrack = actions.find(
            (candidate) => candidate.type === 'createBus' && candidate.payload.busId === action.payload.trackId
        );
        if (createdTrack?.type === 'createBus') {
            return `Set "${createdTrack.payload.name}" (${action.payload.trackId}) fader from ${formatDecibelsFromGain(action.payload.expectedGain)} to ${formatDecibelsFromGain(action.payload.gain)}`;
        }
    }
    if (action.type === 'automateSendRanges' && action.payload.ranges && action.payload.expectedTracks) {
        const targets = action.payload.expectedTracks
            .map(
                (track) =>
                    `"${track.trackName}" (${track.trackId}) ${formatDecibelsFromGain(track.sendLevel)}→${String(action.payload.targetLevelDb)} dB`
            )
            .join(', ');
        const ranges = action.payload.ranges
            .map(
                (range) =>
                    `"${range.sectionName}" (${range.sectionId}) ramp beats ${String(range.automationStartBeat)}–${String(range.endBeat)}`
            )
            .join(', ');
        return `Automate sends to "${action.payload.busName ?? action.payload.busId}" (${action.payload.busId}) over the final ${String(action.payload.tailBars)} bars: ${targets}; ${ranges}; restore base levels at each section end`;
    }
    if (action.type === 'renderProjectSections' && action.payload.jobs) {
        const jobs = action.payload.jobs
            .map(
                (job) =>
                    `"${job.sectionName}" (${job.sectionId}) beats ${String(job.startBeat)}–${String(job.endBeat)} as ${job.jobId} at ${String(job.sampleRate)} Hz with ${String(job.tailSeconds)} s tail`
            )
            .join(', ');
        return `Render ${jobs} into session-owned artifacts; undo removes them and redo renders fresh artifacts`;
    }
    if (action.type === 'automateTrackGainRange' && action.payload.expectedTracks) {
        const targets = action.payload.expectedTracks
            .map(
                (track) =>
                    `"${track.trackName}" (${track.trackId}) ${String(track.gain)}→${String(track.gain * 10 ** (action.payload.gainDb / 20))}`
            )
            .join(', ');
        return `Lift ${targets} by ${String(action.payload.gainDb)} dB only in ${action.payload.sectionName} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}`;
    }
    return describePlannedAction({ action, context });
}

export function describePendingActionConfirmation({
    actions,
    context,
    prompt,
    wholeProjectVibeMixPlan,
    workflowCapabilityId,
}: DescribePendingActionConfirmationInput) {
    const actionLabels = actions.map((action) => describeExactAction(action, actions, context));
    const affectedIds = [...new Set(actions.flatMap((action) => getPlannedActionAffectedIds(action)))];
    const policies = actions.map((action) => getAppActionExecutionPolicy(action.type));
    const riskPolicy = policies.reduce((highest, policy) =>
        riskRank[policy.risk] > riskRank[highest.risk] ? policy : highest
    );
    let risk = {
        level: riskPolicy.risk,
        reason: riskPolicy.reason,
    };
    if (
        actions.length > 1 &&
        (actions.every((action) => action.type === 'addDevice') ||
            actions.every((action) => action.type === 'addAdjustmentRegion')) &&
        riskPolicy.risk === 'bounded-reversible'
    ) {
        risk = {
            level: 'broad-reversible',
            reason: 'This applies the same change to multiple project targets.',
        };
    }
    const protectedUnchanged = getProtectedUnchangedTracks(
        prompt,
        context,
        actions,
        wholeProjectVibeMixPlan,
        workflowCapabilityId
    );
    const intendedChanges = actions
        .map((action, index) => `- **${action.type}**: ${actionLabels[index] ?? action.type}`)
        .join('\n');
    const protectedSummary = protectedUnchanged.map((target) => `"${target.name}" (${target.id})`).join(', ');
    const affectedSummary = affectedIds.join(', ');
    const riskReason = risk.reason ? ` — ${risk.reason}` : '';
    const protectedLine = protectedSummary ? `\n\nProtected unchanged: ${protectedSummary}` : '';
    let planSummary = '';
    if (wholeProjectVibeMixPlan) {
        planSummary = `${describeWholeProjectVibeMixPlan(wholeProjectVibeMixPlan)}\n\n`;
    }
    const content = `${planSummary}This prompt requires confirmation before execution.\n\nRisk: ${risk.level}${riskReason}\n\nIntended changes:\n${intendedChanges}\n\nAffected IDs: ${affectedSummary}${protectedLine}`;
    return { actionLabels, affectedIds, risk, protectedUnchanged, content };
}
