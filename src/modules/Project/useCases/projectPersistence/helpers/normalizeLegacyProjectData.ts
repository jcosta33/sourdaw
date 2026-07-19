import { getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';

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

function stripLegacyGrooveTemplates(value: unknown): unknown {
    if (!isRecord(value) || !Object.hasOwn(value, 'grooveTemplates')) {
        return value;
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'grooveTemplates'));
}

function createStraightGrooveTemplate(): UnknownRecord {
    return {
        id: getStraightGrooveTemplateId(),
        name: 'Straight',
        schemaVersion: 1,
        subdivision: '1/16',
        slots: [],
        provenance: { type: 'builtin', sourceId: 'straight' },
    };
}

function nextAvailableName(name: string, occupiedNames: Set<string>): string {
    const baseName = name.trim() || 'Untitled groove';
    if (!occupiedNames.has(baseName.toLocaleLowerCase())) {
        return baseName;
    }
    let suffix = 2;
    while (occupiedNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) {
        suffix += 1;
    }
    return `${baseName} ${suffix}`;
}

function normalizeLegacyGrooveTemplate(
    value: unknown,
    source: 'yeast' | 'toaster',
    index: number,
    occupiedNames: Set<string>
): UnknownRecord | null {
    if (!isRecord(value) || !Array.isArray(value.offsets)) {
        return null;
    }
    const offsets = value.offsets.filter(
        (offset): offset is number => typeof offset === 'number' && Number.isFinite(offset)
    );
    if (offsets.length === 0 || offsets.length !== value.offsets.length) {
        return null;
    }
    const velocities = Array.isArray(value.velocities)
        ? value.velocities.filter(
              (velocity): velocity is number => typeof velocity === 'number' && Number.isFinite(velocity)
          )
        : [];
    const slots = offsets.flatMap((offset, slotIndex) => {
        const dynamicsOffset =
            velocities[slotIndex] === undefined ? 0 : Math.max(-1, Math.min(1, velocities[slotIndex] - 1));
        const timingOffset = Math.max(-0.5, Math.min(0.5, offset));
        return timingOffset === 0 && dynamicsOffset === 0 ? [] : [{ index: slotIndex, timingOffset, dynamicsOffset }];
    });
    if (slots.length === 0) {
        return createStraightGrooveTemplate();
    }
    const requestedName = typeof value.name === 'string' ? value.name : `${source} groove`;
    const name = nextAvailableName(requestedName, occupiedNames);
    const sourceId = typeof value.id === 'string' ? value.id : `${source}-${index}`;
    const slug =
        sourceId
            .toLocaleLowerCase()
            .replaceAll(/[^a-z0-9]+/g, '-')
            .replaceAll(/^-|-$/g, '') || String(index);
    return {
        id: `legacy-${source}-${slug}`,
        name,
        schemaVersion: 1,
        subdivision: '1/16',
        slots,
        provenance: { type: 'legacy', sourceId: `${source}:${sourceId}` },
    };
}

function normalizeGrooveFields(value: UnknownRecord): UnknownRecord {
    if (isRecord(value.grooves) && Array.isArray(value.grooves.templates) && Array.isArray(value.grooves.assignments)) {
        return {
            ...value,
            yeast: stripLegacyGrooveTemplates(value.yeast),
            toaster: stripLegacyGrooveTemplates(value.toaster),
        };
    }

    const templates: UnknownRecord[] = [createStraightGrooveTemplate()];
    const fingerprints = new Set<string>(['straight']);
    const occupiedNames = new Set<string>(['straight']);
    const occupiedIds = new Set<string>([getStraightGrooveTemplateId()]);
    for (const source of ['yeast', 'toaster'] as const) {
        const sourceState = value[source];
        if (!isRecord(sourceState) || !Array.isArray(sourceState.grooveTemplates)) {
            continue;
        }
        for (const [index, legacyTemplate] of sourceState.grooveTemplates.entries()) {
            const normalized = normalizeLegacyGrooveTemplate(legacyTemplate, source, index, occupiedNames);
            if (!normalized || normalized.id === getStraightGrooveTemplateId()) {
                continue;
            }
            const fingerprint = JSON.stringify([normalized.subdivision, normalized.slots]);
            if (fingerprints.has(fingerprint)) {
                continue;
            }
            fingerprints.add(fingerprint);
            occupiedNames.add(String(normalized.name).toLocaleLowerCase());
            const baseId = String(normalized.id);
            let id = baseId;
            let suffix = 2;
            while (occupiedIds.has(id)) {
                id = `${baseId}-${suffix}`;
                suffix += 1;
            }
            occupiedIds.add(id);
            templates.push({ ...normalized, id });
        }
    }

    return {
        ...value,
        yeast: stripLegacyGrooveTemplates(value.yeast),
        toaster: stripLegacyGrooveTemplates(value.toaster),
        grooves: { templates, assignments: [] },
    };
}

type NormalizeLegacyProjectDataOutput = unknown;

export function normalizeLegacyProjectData(value: unknown): NormalizeLegacyProjectDataOutput {
    if (!isRecord(value) || value.version !== 1) {
        return value;
    }
    const normalizedGrooves = normalizeGrooveFields(value);
    if (normalizedGrooves.meta !== undefined || normalizedGrooves.arrangement !== undefined) {
        return normalizeAutomationFields(normalizedGrooves);
    }
    if (typeof normalizedGrooves.name !== 'string' || !isRecord(normalizedGrooves.tracks)) {
        return normalizedGrooves;
    }

    const markerState = isRecord(normalizedGrooves.markers) ? normalizedGrooves.markers : undefined;
    const markers = Array.isArray(markerState?.markers) ? markerState.markers : [];
    const arrangementId = 'legacy-arrangement';
    const arrangements = Array.isArray(normalizedGrooves.arrangements)
        ? normalizedGrooves.arrangements
        : [
              {
                  id: arrangementId,
                  name: 'Arrangement 1',
                  tracks: normalizedGrooves.tracks,
                  automation: normalizedGrooves.automation,
                  midi: normalizedGrooves.midi,
                  tempoMap: normalizedGrooves.tempoMap,
                  timeSignatureMap: normalizedGrooves.timeSignatureMap,
                  markers: markerState,
                  takeLanes: normalizedGrooves.takeLanes,
              },
          ];
    const activeArrangementId =
        typeof normalizedGrooves.activeArrangementId === 'string'
            ? normalizedGrooves.activeArrangementId
            : arrangementId;

    return normalizeAutomationFields({
        version: normalizedGrooves.version,
        meta: {
            name: normalizedGrooves.name,
            createdAt: normalizedGrooves.createdAt,
            updatedAt: normalizedGrooves.updatedAt,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: normalizedGrooves.transport,
        arrangement: { tracks: normalizedGrooves.tracks.tracks },
        automation: normalizedGrooves.automation,
        midi: normalizedGrooves.midi,
        grooves: normalizedGrooves.grooves,
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers,
        tempoMap: normalizedGrooves.tempoMap,
        timeSignatureMap: normalizedGrooves.timeSignatureMap,
        takeLanes: normalizedGrooves.takeLanes,
        sidechainRoutes: normalizedGrooves.sidechainRoutes,
        arrangements,
        activeArrangementId,
        history: { checkpoints: [] },
    });
}
