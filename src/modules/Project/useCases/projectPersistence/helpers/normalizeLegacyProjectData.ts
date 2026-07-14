type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAutomationPoint(value: unknown): unknown {
    if (!isRecord(value) || value.tension !== undefined) {
        return value;
    }
    return { ...value, tension: 0 };
}

function normalizeAutomationObject(value: unknown): unknown {
    if (!isRecord(value) || !Array.isArray(value.points)) {
        return value;
    }
    return { ...value, points: value.points.map(normalizeAutomationPoint) };
}

function normalizeAutomation(value: unknown): unknown {
    if (!isRecord(value) || !Array.isArray(value.lanes)) {
        return value;
    }
    const lanes: unknown[] = value.lanes;
    return {
        ...value,
        lanes: lanes.map((lane): unknown => {
            if (!isRecord(lane) || !Array.isArray(lane.points)) {
                return lane;
            }
            let objects: unknown = lane.objects;
            if (objects === undefined) {
                objects = [];
            } else if (Array.isArray(objects)) {
                const entries: unknown[] = objects;
                objects = entries.map(normalizeAutomationObject);
            }
            return {
                ...lane,
                points: lane.points.map(normalizeAutomationPoint),
                objects,
                visible: lane.visible === undefined ? true : lane.visible,
                enabled: lane.enabled === undefined ? true : lane.enabled,
                collapsed: lane.collapsed === undefined ? false : lane.collapsed,
                virginTerritory: lane.virginTerritory === undefined ? true : lane.virginTerritory,
                minValue: lane.minValue === undefined ? 0 : lane.minValue,
                maxValue: lane.maxValue === undefined ? 1 : lane.maxValue,
            };
        }),
    };
}

function normalizeAutomationFields(value: UnknownRecord): UnknownRecord {
    const normalized =
        value.automation === undefined ? value : { ...value, automation: normalizeAutomation(value.automation) };
    if (!Array.isArray(normalized.arrangements)) {
        return normalized;
    }
    const arrangements: unknown[] = normalized.arrangements;
    return {
        ...normalized,
        arrangements: arrangements.map((arrangement): unknown =>
            isRecord(arrangement) && arrangement.automation !== undefined
                ? { ...arrangement, automation: normalizeAutomation(arrangement.automation) }
                : arrangement
        ),
    };
}

type NormalizeLegacyProjectDataOutput = unknown;

export function normalizeLegacyProjectData(value: unknown): NormalizeLegacyProjectDataOutput {
    if (!isRecord(value) || value.version !== 1) {
        return value;
    }
    if (value.meta !== undefined || value.arrangement !== undefined) {
        return normalizeAutomationFields(value);
    }
    if (typeof value.name !== 'string' || !isRecord(value.tracks)) {
        return value;
    }

    const markerState = isRecord(value.markers) ? value.markers : undefined;
    const markers = Array.isArray(markerState?.markers) ? markerState.markers : [];
    const arrangementId = 'legacy-arrangement';
    const arrangements = Array.isArray(value.arrangements)
        ? value.arrangements
        : [
              {
                  id: arrangementId,
                  name: 'Arrangement 1',
                  tracks: value.tracks,
                  automation: value.automation,
                  midi: value.midi,
                  tempoMap: value.tempoMap,
                  timeSignatureMap: value.timeSignatureMap,
                  markers: markerState,
                  takeLanes: value.takeLanes,
              },
          ];
    const activeArrangementId =
        typeof value.activeArrangementId === 'string' ? value.activeArrangementId : arrangementId;

    return normalizeAutomationFields({
        version: value.version,
        meta: {
            name: value.name,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: value.transport,
        arrangement: { tracks: value.tracks.tracks },
        automation: value.automation,
        midi: value.midi,
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers,
        tempoMap: value.tempoMap,
        timeSignatureMap: value.timeSignatureMap,
        takeLanes: value.takeLanes,
        sidechainRoutes: value.sidechainRoutes,
        arrangements,
        activeArrangementId,
        history: { checkpoints: [] },
    });
}
