import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

type MaterializedCommandApplicationIds = {
    action: AppAction;
    applicationAssignedIds: readonly CommandApplicationAssignedId[];
};

type ApplicationIdRule = {
    argument: string;
    prefix: string;
};

const APPLICATION_ID_RULES: Partial<Record<AppActionType, ApplicationIdRule>> = {
    addAdjustmentRegion: { argument: 'regionId', prefix: 'adjustment-region-command-' },
    addAutomationLane: { argument: 'laneId', prefix: 'automation-command-' },
    addAutomationPoint: { argument: 'pointId', prefix: 'automation-point-command-' },
    addChordEvent: { argument: 'eventId', prefix: 'chord-command-' },
    addClip: { argument: 'id', prefix: 'clip-command-' },
    addDevice: { argument: 'deviceId', prefix: 'device-command-' },
    addMarker: { argument: 'markerId', prefix: 'marker-command-' },
    addSection: { argument: 'sectionId', prefix: 'section-command-' },
    addSidechainRoute: { argument: 'routeId', prefix: 'sidechain-command-' },
    addTrack: { argument: 'id', prefix: 'track-command-' },
    createAdjustmentLayer: { argument: 'layerId', prefix: 'adjustment-layer-command-' },
    createBus: { argument: 'busId', prefix: 'bus-command-' },
    createTrackAlternative: { argument: 'alternativeId', prefix: 'alternative-command-' },
    createVcaGroup: { argument: 'vcaGroupId', prefix: 'vca-command-' },
    duplicateClip: { argument: 'targetClipId', prefix: 'clip-command-' },
    duplicateClipToNextBar: { argument: 'targetClipId', prefix: 'clip-command-' },
    duplicateTrack: { argument: 'targetTrackId', prefix: 'track-command-' },
    splitClip: { argument: 'rightClipId', prefix: 'clip-command-' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function materializeCommandApplicationIds(action: AppAction): MaterializedCommandApplicationIds {
    const rule = APPLICATION_ID_RULES[action.type];
    const payload: unknown = 'payload' in action ? action.payload : undefined;
    if (!rule || !isRecord(payload)) {
        return { action, applicationAssignedIds: [] };
    }
    if (typeof payload[rule.argument] === 'string' && payload[rule.argument] !== '') {
        return { action, applicationAssignedIds: [] };
    }

    const cloned = structuredClone(action);
    const clonedPayload: unknown = 'payload' in cloned ? cloned.payload : undefined;
    if (!isRecord(clonedPayload)) {
        return { action, applicationAssignedIds: [] };
    }
    const value = `${rule.prefix}${crypto.randomUUID()}`;
    clonedPayload[rule.argument] = value;
    return {
        action: cloned,
        applicationAssignedIds: [{ argument: rule.argument, value }],
    };
}
