import { type AppAction } from '#/utils/handlerContract';

import {
    AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
    type AgentAutomationCurveLane,
    type AgentDomainPreviewInput,
    type AgentDomainPreviewResult,
} from '../../models/AgentDomainPreview';
import {
    isProjectedRecord,
    readProjectedEntries,
    readProjectedNumber,
    readProjectedSlot,
    readProjectedString,
} from '../../services/projectedDocumentSlot';

import { resolveAgentPreviewDomains } from './resolveAgentPreviewDomains';

/**
 * The projected breakpoints of the automation lanes a batch names.
 *
 * Points come from the `automation` slot's lanes in the isolated post-state and
 * are reported in beat order, which is the order the curve is evaluated in.
 */

type TrackParameterTarget = { trackId: string; parameterId: string };

function previewedPayloads(actions: readonly AppAction[]): Readonly<Record<string, unknown>>[] {
    return actions.flatMap((action) => {
        if (!resolveAgentPreviewDomains([action]).includes('automation-curve') || !isProjectedRecord(action.payload)) {
            return [];
        }
        return [action.payload];
    });
}

function affectedLaneIds(actions: readonly AppAction[]): ReadonlySet<string> {
    return new Set(
        previewedPayloads(actions).flatMap((payload) => {
            const laneId = readProjectedString(payload, 'laneId');
            return laneId === null ? [] : [laneId];
        })
    );
}

/**
 * The track parameters a batch automates without naming a lane: a range write lands on whichever
 * track-level lane carries the parameter, creating it if none does, so its lane is found by owner.
 */
function affectedTrackParameters(actions: readonly AppAction[]): readonly TrackParameterTarget[] {
    return previewedPayloads(actions).flatMap((payload) => {
        const trackId = readProjectedString(payload, 'trackId');
        const parameterId = readProjectedString(payload, 'parameterId');
        if (readProjectedString(payload, 'laneId') !== null || trackId === null || parameterId === null) {
            return [];
        }
        return [{ trackId, parameterId }];
    });
}

function isTrackParameterLane(
    lane: Readonly<Record<string, unknown>>,
    targets: readonly TrackParameterTarget[]
): boolean {
    if (readProjectedString(lane, 'clipId') !== null) {
        return false;
    }
    const trackId = readProjectedString(lane, 'trackId');
    const parameterId = readProjectedString(lane, 'parameterId');
    return targets.some((target) => target.trackId === trackId && target.parameterId === parameterId);
}

function projectedPoints(lane: Readonly<Record<string, unknown>>): AgentAutomationCurveLane['points'] {
    const points = readProjectedEntries(lane, 'points') ?? [];
    return points
        .flatMap((point) => {
            const beat = readProjectedNumber(point, 'beat');
            const value = readProjectedNumber(point, 'value');
            if (beat === null || value === null) {
                return [];
            }
            return [{ beat, value }];
        })
        .sort((left, right) => left.beat - right.beat);
}

export function previewAutomationCurve(input: AgentDomainPreviewInput): AgentDomainPreviewResult {
    const automationSlot = readProjectedSlot(input.projectDocument, 'automation');
    const lanes = automationSlot === null ? null : readProjectedEntries(automationSlot, 'lanes');
    if (lanes === null) {
        return { status: 'unsupported', domain: 'automation-curve', reason: 'projection-slot-missing' };
    }
    const laneIds = affectedLaneIds(input.actions);
    const trackParameters = affectedTrackParameters(input.actions);
    return {
        status: 'previewed',
        domain: 'automation-curve',
        schemaVersion: AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
        handle: lanes.flatMap((lane) => {
            const laneId = readProjectedString(lane, 'id');
            if (laneId === null || !(laneIds.has(laneId) || isTrackParameterLane(lane, trackParameters))) {
                return [];
            }
            return [{ laneId, points: projectedPoints(lane) }];
        }),
    };
}
