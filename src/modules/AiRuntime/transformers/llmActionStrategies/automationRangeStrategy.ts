import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';
import { type LlmActionRejection, type SectionPlanningSignature } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

import {
    findSend,
    findTrack,
    hasExactKeys,
    isFiniteNumber,
    isProviderRoutableSource,
    normalizeMarkerName,
    rejection,
} from './bridgeArgumentGuards';
import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const automationRangeActionNames = [
    'addAdjustmentRegion',
    'automateSendRange',
    'automateTrackGainRange',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type AutomationRangeCallName = (typeof automationRangeActionNames)[number];

type AutomationRangeStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
    sectionSignatures: readonly SectionPlanningSignature[];
};

type AutomationRangeStrategy<Name extends AutomationRangeCallName> = (
    input: AutomationRangeStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type AutomationRangeStrategyDefinition<Name extends AutomationRangeCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: AutomationRangeStrategy<StrategyName>;
    };
}[Name];

const automationRangeStrategyDefinitions = [
    {
        name: 'addAdjustmentRegion',
        transform: ({ call, index }) => {
            const args = call.arguments;
            const { layerId, startBeat, endBeat, blend, fadeInBeats, fadeOutBeats } = args;
            if (
                !hasExactKeys(args, ['layerId', 'startBeat', 'endBeat', 'blend', 'fadeInBeats', 'fadeOutBeats']) ||
                typeof layerId !== 'string' ||
                !isFiniteNumber(startBeat) ||
                startBeat < 0 ||
                !isFiniteNumber(endBeat) ||
                endBeat <= startBeat ||
                !isFiniteNumber(blend) ||
                blend < 0 ||
                blend > 1 ||
                !isFiniteNumber(fadeInBeats) ||
                fadeInBeats < 0 ||
                !isFiniteNumber(fadeOutBeats) ||
                fadeOutBeats < 0 ||
                fadeInBeats + fadeOutBeats > endBeat - startBeat
            ) {
                return rejection(index, call.name, 'Expected one exact bounded adjustment-layer region');
            }
            return {
                type: 'addAdjustmentRegion',
                payload: { layerId, startBeat, endBeat, blend, fadeInBeats, fadeOutBeats },
            };
        },
    },
    {
        name: 'automateSendRange',
        transform: ({ call, context, index, sectionSignatures }) => {
            const args = call.arguments;
            const trackIds = args.trackIds;
            const bus = findTrack(context, args.busId);
            const sectionName = normalizeSafeProjectName(args.sectionName);
            const sections = sectionSignatures.filter(
                (section) =>
                    section.sectionId && normalizeMarkerName(section.name) === normalizeMarkerName(sectionName ?? '')
            );
            if (
                !hasExactKeys(args, ['trackIds', 'busId', 'sectionName', 'reductionDb']) ||
                !Array.isArray(trackIds) ||
                trackIds.length === 0 ||
                !trackIds.every((trackId): trackId is string => typeof trackId === 'string') ||
                new Set(trackIds).size !== trackIds.length ||
                bus?.kind !== 'bus' ||
                !sectionName ||
                sections.length !== 1 ||
                !isFiniteNumber(args.reductionDb) ||
                args.reductionDb <= 0 ||
                args.reductionDb > 60
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected exact source IDs, one existing bus and section, and a positive bounded dB reduction'
                );
            }
            const hasInvalidSource = trackIds.some((trackId) => {
                const track = findTrack(context, trackId);
                const send = findSend(context, trackId, bus.id);
                return (
                    !isProviderRoutableSource(track) ||
                    track.automationMode === 'off' ||
                    !send ||
                    !Number.isFinite(send.level) ||
                    send.level <= 0 ||
                    (context.automationLanes ?? []).some(
                        (lane) => !lane.clipId && lane.trackId === trackId && lane.parameterId === `send:${bus.id}`
                    )
                );
            });
            if (hasInvalidSource) {
                return rejection(
                    index,
                    call.name,
                    'Expected every source to read automation and own a positive send to the bus without existing send automation'
                );
            }
            return {
                type: 'automateSendRange',
                payload: {
                    trackIds: [...trackIds],
                    busId: bus.id,
                    sectionName: sections[0]!.name,
                    reductionDb: args.reductionDb,
                },
            };
        },
    },
    {
        name: 'automateTrackGainRange',
        transform: ({ call, context, index, sectionSignatures }) => {
            const args = call.arguments;
            const trackIds = args.trackIds;
            const sectionName = normalizeSafeProjectName(args.sectionName);
            const gainDb = args.gainDb;
            const sections = sectionSignatures.filter(
                (section) =>
                    section.sectionId && normalizeMarkerName(section.name) === normalizeMarkerName(sectionName ?? '')
            );
            if (
                !hasExactKeys(args, ['trackIds', 'sectionName', 'gainDb']) ||
                !Array.isArray(trackIds) ||
                trackIds.length === 0 ||
                !trackIds.every((trackId): trackId is string => typeof trackId === 'string') ||
                new Set(trackIds).size !== trackIds.length ||
                !sectionName ||
                sections.length !== 1 ||
                !isFiniteNumber(gainDb) ||
                gainDb <= 0 ||
                gainDb > 6
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected exact impact-bus IDs, one existing section, and a positive bounded dB lift'
                );
            }
            const hasInvalidTarget = trackIds.some((trackId) => {
                const track = findTrack(context, trackId);
                return (
                    track?.kind !== 'bus' ||
                    track.frozen === true ||
                    track.automationMode === 'off' ||
                    !Number.isFinite(track.gain) ||
                    track.gain <= 0 ||
                    // The lift must land inside the fader's own range, which is
                    // `FADER_MAX_GAIN` and not unity — `handleAutomateTrackGainRange`
                    // admits exactly that, so a unity bound here would reject a bus
                    // at the 0.8 default asked for a 3 dB section lift and leave the
                    // handler's own check unreachable.
                    track.gain * 10 ** (gainDb / 20) > FADER_MAX_GAIN ||
                    (context.automationLanes ?? []).some(
                        (lane) =>
                            lane.id === `auto-gain-${encodeURIComponent(trackId)}` ||
                            (!lane.clipId && lane.trackId === trackId && lane.parameterId === 'gain')
                    )
                );
            });
            if (hasInvalidTarget) {
                return rejection(
                    index,
                    call.name,
                    'Expected every impact bus to have gain headroom, enabled automation, and no existing gain lane'
                );
            }
            return {
                type: 'automateTrackGainRange',
                payload: {
                    trackIds: [...trackIds],
                    sectionName: sections[0]!.name,
                    gainDb,
                },
            };
        },
    },
] as const satisfies readonly AutomationRangeStrategyDefinition<AutomationRangeCallName>[];

export const automationRangeStrategyRegistry = createLlmActionStrategyRegistry<
    AutomationRangeCallName,
    AutomationRangeStrategyInput,
    RuntimeAction | LlmActionRejection
>(automationRangeStrategyDefinitions, automationRangeActionNames);

function isAutomationRangeCallName(value: string): value is AutomationRangeCallName {
    return automationRangeActionNames.some((actionName) => actionName === value);
}

export function bridgeAutomationRangeToolCall(
    input: AutomationRangeStrategyInput
): RuntimeAction | LlmActionRejection | null {
    if (!isAutomationRangeCallName(input.call.name)) {
        return null;
    }
    const strategy = automationRangeStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
