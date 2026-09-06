import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { type WholeProjectVibeMixPlan } from '../../models/WholeProjectVibeMixPlan';
import { type WorkflowCapabilityId } from '../../models/WorkflowCapability';

import { getArticulationTransferPromptScope } from './getArticulationTransferPromptScope';
import { getBackingVocalPlatePromptScope } from './getBackingVocalPlatePromptScope';
import { getBassProcessingCopyPromptScope } from './getBassProcessingCopyPromptScope';
import { getBulkDeviceInsertionTrackScope } from './getBulkDeviceInsertionTrackScope';
import { getDeviceParameterPromptScope } from './getDeviceParameterPromptScope';
import { getDrumPreviewBranchesPromptScope } from './getDrumPreviewBranchesPromptScope';
import { getDrumRenderComparisonPromptScope } from './getDrumRenderComparisonPromptScope';
import { getDrumRoutingPromptScope } from './getDrumRoutingPromptScope';
import { getExplicitClipProtection } from './getExplicitlyProtectedClips';
import { getMidiOverlapTransformPromptScope } from './getMidiOverlapTransformPromptScope';
import { getMutedEmptyTrackDeletionScope } from './getMutedEmptyTrackDeletionScope';
import { getSharedVocalFxBusesPromptScope } from './getSharedVocalFxBusesPromptScope';
import { getSidechainRoutingPromptScope } from './getSidechainRoutingPromptScope';
import { getSyncopatedArpeggioPromptScope } from './getSyncopatedArpeggioPromptScope';

export type ApplicationProtectedObject = { id: string; name: string };

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** Derives every protected object from application state, actions, and workflow semantics. */
export function getApplicationProtectedObjects(input: {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan;
    workflowCapabilityId?: WorkflowCapabilityId;
}): ApplicationProtectedObject[] {
    const { actions, context, prompt, wholeProjectVibeMixPlan, workflowCapabilityId } = input;
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
    const protectedParameters = deviceParameterScope
        ? deviceParameterScope.protectedParameters.map((parameter) => {
              const deviceName = deviceParameterScope.device.name ?? deviceParameterScope.device.type;
              return {
                  id: `${deviceParameterScope.device.id}:${parameter.id}`,
                  name: `${deviceParameterScope.track.name} ${deviceName} ${parameter.name} = ${String(parameter.value)}${parameter.unit === ':1' ? ':1' : ` ${parameter.unit}`}`,
              };
          })
        : [];
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
    const explicitClipProtection = getExplicitClipProtection(prompt, context);
    const protections = [
        ...(actions.some((action) => action.type === 'importStemSet')
            ? context.tracks.map(({ id, name }) => ({ id, name }))
            : []),
        ...protectedTracks.map(({ id, name }) => ({ id, name })),
        ...explicitClipProtection.clips,
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
