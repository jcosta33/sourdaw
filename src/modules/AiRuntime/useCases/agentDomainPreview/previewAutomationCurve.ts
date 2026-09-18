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

function affectedLaneIds(actions: readonly AppAction[]): ReadonlySet<string> {
    return new Set(
        actions.flatMap((action) => {
            if (!resolveAgentPreviewDomains([action]).includes('automation-curve')) {
                return [];
            }
            if (!isProjectedRecord(action.payload)) {
                return [];
            }
            const laneId = readProjectedString(action.payload, 'laneId');
            return laneId === null ? [] : [laneId];
        })
    );
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
    return {
        status: 'previewed',
        domain: 'automation-curve',
        schemaVersion: AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
        handle: lanes.flatMap((lane) => {
            const laneId = readProjectedString(lane, 'id');
            if (laneId === null || !laneIds.has(laneId)) {
                return [];
            }
            return [{ laneId, points: projectedPoints(lane) }];
        }),
    };
}
