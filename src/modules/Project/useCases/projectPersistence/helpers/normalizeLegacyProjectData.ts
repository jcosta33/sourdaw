import {
    GROOVE_CONSUMER_TYPES,
    canonicalizeGrooveConsumerId,
    defaultGrooveTemplateState,
    isGrooveTemplateState,
    sanitizeGrooveTemplateState,
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
} from '#/modules/MIDI/stores';
import {
    getCanonicalGrooveTemplateKey,
    getScopedGrooveConsumerId,
    getStraightGrooveTemplateId,
} from '#/modules/MIDI/useCases';

import { createProjectId, CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateVersion1ProjectIdentity(value: unknown): unknown {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.meta) || typeof value.meta.createdAt !== 'number') {
        return value;
    }
    return {
        ...value,
        version: CURRENT_PROJECT_VERSION,
        meta: {
            ...value.meta,
            projectId: createProjectId(),
        },
    };
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
            const normalizedLane: UnknownRecord = {
                ...lane,
                points: lane.points.map(normalizeAutomationPoint),
                objects,
                visible: lane.visible === undefined ? true : lane.visible,
                enabled: lane.enabled === undefined ? true : lane.enabled,
                collapsed: lane.collapsed === undefined ? false : lane.collapsed,
                minValue: lane.minValue === undefined ? 0 : lane.minValue,
                maxValue: lane.maxValue === undefined ? 1 : lane.maxValue,
            };
            // `virginTerritory` was removed from the lane model. A file
            // written by an older build still carries it, and the spread above
            // would carry it straight through into the hydrated store — so this
            // build would write the retired field back out on the next save,
            // keeping it alive in user projects forever. Strip it here, where
            // the other legacy shape migrations live. Loading is unaffected:
            // the validator no longer requires the key, it just ignores it.
            Reflect.deleteProperty(normalizedLane, 'virginTerritory');
            return normalizedLane;
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

function stripLegacyGrooveFields(value: unknown): unknown {
    if (!isRecord(value) || (!Object.hasOwn(value, 'grooveTemplates') && !Object.hasOwn(value, 'assignments'))) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== 'grooveTemplates' && key !== 'assignments')
    );
}

function stripLegacyYeastViewState(value: UnknownRecord): UnknownRecord {
    if (!isRecord(value.yeast) || !Object.hasOwn(value.yeast, 'uiLevel')) {
        return value;
    }
    const yeast = Object.fromEntries(Object.entries(value.yeast).filter(([key]) => key !== 'uiLevel'));
    if (Object.keys(yeast).length === 0) {
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'yeast'));
    }
    return { ...value, yeast };
}

function migrateLegacyStraightAssignmentAlias(value: UnknownRecord): UnknownRecord {
    if (!Array.isArray(value.assignments)) {
        return value;
    }
    const foundAlias = value.assignments.some(
        (assignment) => isRecord(assignment) && assignment.templateId === 'straight'
    );
    if (!foundAlias) {
        return value;
    }
    const assignments = value.assignments.map((assignment): unknown => {
        if (!isRecord(assignment) || assignment.templateId !== 'straight') {
            return assignment;
        }
        return { ...assignment, templateId: getStraightGrooveTemplateId() };
    });
    return { ...value, assignments };
}

function nextAvailableName(name: string, occupiedNames: Set<string>): string {
    const baseName = name.trim() || 'Untitled groove';
    if (!occupiedNames.has(getCanonicalGrooveTemplateKey(baseName))) {
        return baseName;
    }
    let suffix = 2;
    while (occupiedNames.has(getCanonicalGrooveTemplateKey(`${baseName} ${suffix}`))) {
        suffix += 1;
    }
    return `${baseName} ${suffix}`;
}

type NormalizedLegacyGrooveTemplate = {
    sourceId: string;
    template: UnknownRecord;
};

const LEGACY_YEAST_PROCESSOR_GROOVES = [
    { name: 'Straight', offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'MPC Swing', offsets: [0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12] },
    {
        name: 'Triplet Shuffle',
        offsets: [0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167],
    },
    { name: 'Late Backbeat', offsets: [0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 0, 0, 0.05, 0, 0, 0] },
    {
        name: 'Dilla Pocket',
        offsets: [0, 0.08, -0.03, 0.15, 0, 0.06, -0.02, 0.12, 0, 0.09, -0.04, 0.14, 0, 0.07, -0.03, 0.11],
    },
    { name: 'Push', offsets: [-0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0] },
] as const;

type LegacyYeastProcessorGroove = {
    processorId: string;
    templateIndex: number;
    amount: number;
};

function getLegacyYeastProcessorGrooves(value: UnknownRecord): LegacyYeastProcessorGroove[] {
    if (!isRecord(value.yeast) || !Array.isArray(value.yeast.processors)) {
        return [];
    }
    return value.yeast.processors.flatMap((processor): LegacyYeastProcessorGroove[] => {
        if (
            !isRecord(processor) ||
            processor.type !== 'groove' ||
            typeof processor.id !== 'string' ||
            !isRecord(processor.params)
        ) {
            return [];
        }
        const hasTemplate = typeof processor.params.template === 'number' && Number.isFinite(processor.params.template);
        const hasAmount = typeof processor.params.amount === 'number' && Number.isFinite(processor.params.amount);
        if (!hasTemplate && !hasAmount) {
            return [];
        }
        const processorId = canonicalizeGrooveConsumerId(processor.id);
        if (!processorId) {
            return [];
        }
        let rawTemplateIndex = 0;
        if (hasTemplate) {
            rawTemplateIndex = Number(processor.params.template);
        }
        const templateIndex = Math.max(
            0,
            Math.min(LEGACY_YEAST_PROCESSOR_GROOVES.length - 1, Math.round(rawTemplateIndex))
        );
        let amount = 0.5;
        if (hasAmount) {
            amount = Math.max(0, Math.min(1, Number(processor.params.amount)));
        }
        return [{ processorId, templateIndex, amount }];
    });
}

function stripLegacyYeastProcessorGrooveParams(value: unknown): unknown {
    if (!isRecord(value) || !Array.isArray(value.processors)) {
        return value;
    }
    return {
        ...value,
        processors: value.processors.map((processor): unknown => {
            if (!isRecord(processor) || processor.type !== 'groove' || !isRecord(processor.params)) {
                return processor;
            }
            if (!Object.hasOwn(processor.params, 'template') && !Object.hasOwn(processor.params, 'amount')) {
                return processor;
            }
            const params = Object.fromEntries(
                Object.entries(processor.params).filter(([key]) => key !== 'template' && key !== 'amount')
            );
            const processorWithoutParams = Object.fromEntries(
                Object.entries(processor).filter(([key]) => key !== 'params')
            );
            if (Object.keys(params).length === 0) {
                return processorWithoutParams;
            }
            return { ...processorWithoutParams, params };
        }),
    };
}

function normalizeLegacyGrooveTemplate(
    value: unknown,
    source: 'yeast' | 'toaster',
    index: number,
    occupiedNames: Set<string>
): NormalizedLegacyGrooveTemplate | null {
    if (!isRecord(value) || !Array.isArray(value.offsets)) {
        return null;
    }
    const offsets = value.offsets.filter(
        (offset): offset is number => typeof offset === 'number' && Number.isFinite(offset)
    );
    if (offsets.length === 0 || offsets.length !== value.offsets.length) {
        return null;
    }
    let velocities: unknown[] = [];
    if (Array.isArray(value.velocities)) {
        velocities = value.velocities;
    }
    const slots: Array<{ index: number; timingOffset: number; dynamicsOffset: number }> = [];
    for (const [slotIndex, offset] of offsets.entries()) {
        let dynamicsOffset = 0;
        const velocity = velocities[slotIndex];
        if (typeof velocity === 'number' && Number.isFinite(velocity)) {
            dynamicsOffset = Math.max(-1, Math.min(1, velocity - 1));
        }
        const timingOffset = Math.max(-0.5, Math.min(0.5, offset));
        if (timingOffset === 0 && dynamicsOffset === 0) {
            continue;
        }
        slots.push({ index: slotIndex, timingOffset, dynamicsOffset });
    }
    const sourceId = typeof value.id === 'string' ? value.id : `${source}-${index}`;
    if (slots.length === 0) {
        const straight = defaultGrooveTemplateState.templates.find(
            (template) => template.id === getStraightGrooveTemplateId()
        );
        if (!straight) {
            return null;
        }
        return { sourceId, template: { ...structuredClone(straight) } };
    }
    const requestedName = typeof value.name === 'string' ? value.name : `${source} groove`;
    const name = nextAvailableName(requestedName, occupiedNames);
    const slug =
        getCanonicalGrooveTemplateKey(sourceId)
            .replaceAll(/[^a-z0-9]+/g, '-')
            .replaceAll(/^-|-$/g, '') || String(index);
    return {
        sourceId,
        template: {
            id: `legacy-${source}-${slug}`,
            name,
            schemaVersion: 1,
            subdivision: '1/16',
            slots,
            provenance: { type: 'legacy', sourceId: `${source}:${sourceId}` },
        },
    };
}

function normalizeLegacyGrooveAssignment({
    value,
    source,
    templateIdMappings,
    templateIds,
}: {
    value: unknown;
    source: 'yeast' | 'toaster';
    templateIdMappings: ReadonlyMap<string, string>;
    templateIds: ReadonlySet<string>;
}): GrooveTemplateAssignment | null {
    if (
        !isRecord(value) ||
        !GROOVE_CONSUMER_TYPES.includes(value.consumerType as GrooveConsumerType) ||
        typeof value.consumerId !== 'string' ||
        value.consumerId.trim().length === 0 ||
        typeof value.templateId !== 'string' ||
        value.templateId.length === 0 ||
        typeof value.amount !== 'number' ||
        !Number.isFinite(value.amount)
    ) {
        return null;
    }
    const consumerId = canonicalizeGrooveConsumerId(value.consumerId);
    if (!consumerId) {
        return null;
    }
    const mappedTemplateId = templateIdMappings.get(`${source}:${value.templateId}`);
    let templateId = mappedTemplateId;
    if (!templateId && templateIds.has(value.templateId)) {
        templateId = value.templateId;
    }
    if (!templateId) {
        templateId = getStraightGrooveTemplateId();
    }
    return {
        consumerType: value.consumerType as GrooveConsumerType,
        consumerId,
        templateId,
        amount: Math.max(0, Math.min(1, value.amount)),
    };
}

function normalizeGrooveFields(value: UnknownRecord): UnknownRecord {
    const legacyYeastProcessorGrooves = getLegacyYeastProcessorGrooves(value);
    const hasIdentifiedLegacyGrooveFields =
        legacyYeastProcessorGrooves.length > 0 ||
        ['yeast', 'toaster'].some((source) => {
            const sourceState = value[source];
            return (
                isRecord(sourceState) &&
                (Array.isArray(sourceState.grooveTemplates) || Array.isArray(sourceState.assignments))
            );
        });
    if (!hasIdentifiedLegacyGrooveFields) {
        if (
            isRecord(value.grooves) &&
            Array.isArray(value.grooves.templates) &&
            Array.isArray(value.grooves.assignments)
        ) {
            let grooves = value.grooves;
            if (!isGrooveTemplateState(grooves)) {
                grooves = migrateLegacyStraightAssignmentAlias(grooves);
            }
            if (grooves === value.grooves) {
                return value;
            }
            return { ...value, grooves };
        }
        return value;
    }

    let initialGrooves = structuredClone(defaultGrooveTemplateState);
    if (isRecord(value.grooves)) {
        initialGrooves = sanitizeGrooveTemplateState(migrateLegacyStraightAssignmentAlias(value.grooves));
    }
    const templates: UnknownRecord[] = structuredClone(initialGrooves.templates).filter(isRecord);
    const templateIdByFingerprint = new Map<string, string>(
        templates.map((template) => [JSON.stringify([template.subdivision, template.slots]), String(template.id)])
    );
    const occupiedNames = new Set<string>(
        templates.map((template) => getCanonicalGrooveTemplateKey(String(template.name)))
    );
    const occupiedIds = new Set<string>(templates.map((template) => String(template.id)));
    const templateIdMappings = new Map<string, string>();
    function registerLegacyTemplate(value: unknown, source: 'yeast' | 'toaster', index: number): void {
        const normalized = normalizeLegacyGrooveTemplate(value, source, index, occupiedNames);
        if (!normalized) {
            return;
        }
        const { sourceId, template } = normalized;
        if (template.id === getStraightGrooveTemplateId()) {
            templateIdMappings.set(`${source}:${sourceId}`, getStraightGrooveTemplateId());
            return;
        }
        const fingerprint = JSON.stringify([template.subdivision, template.slots]);
        const equivalentTemplateId = templateIdByFingerprint.get(fingerprint);
        if (equivalentTemplateId) {
            templateIdMappings.set(`${source}:${sourceId}`, equivalentTemplateId);
            return;
        }
        occupiedNames.add(getCanonicalGrooveTemplateKey(String(template.name)));
        const baseId = String(template.id);
        let id = baseId;
        let suffix = 2;
        while (occupiedIds.has(id)) {
            id = `${baseId}-${suffix}`;
            suffix += 1;
        }
        occupiedIds.add(id);
        templateIdByFingerprint.set(fingerprint, id);
        templateIdMappings.set(`${source}:${sourceId}`, id);
        templates.push({ ...template, id });
    }

    for (const source of ['yeast', 'toaster'] as const) {
        const sourceState = value[source];
        if (!isRecord(sourceState) || !Array.isArray(sourceState.grooveTemplates)) {
            continue;
        }
        for (const [index, legacyTemplate] of sourceState.grooveTemplates.entries()) {
            registerLegacyTemplate(legacyTemplate, source, index);
        }
    }

    const legacyProcessorTemplateIndices = [
        ...new Set(legacyYeastProcessorGrooves.map((entry) => entry.templateIndex)),
    ].sort((left, right) => left - right);
    for (const templateIndex of legacyProcessorTemplateIndices) {
        registerLegacyTemplate(
            {
                id: `processor-template-${templateIndex}`,
                ...LEGACY_YEAST_PROCESSOR_GROOVES[templateIndex],
            },
            'yeast',
            templateIndex
        );
    }

    const assignmentsByConsumer = new Map<string, GrooveTemplateAssignment>(
        initialGrooves.assignments.map((assignment) => [
            `${assignment.consumerType}:${assignment.consumerId}`,
            assignment,
        ])
    );
    const canonicalAssignmentKeys = new Set(assignmentsByConsumer.keys());
    for (const source of ['yeast', 'toaster'] as const) {
        const sourceState = value[source];
        if (!isRecord(sourceState) || !Array.isArray(sourceState.assignments)) {
            continue;
        }
        for (const legacyAssignment of sourceState.assignments) {
            const assignment = normalizeLegacyGrooveAssignment({
                value: legacyAssignment,
                source,
                templateIdMappings,
                templateIds: occupiedIds,
            });
            if (assignment) {
                const key = `${assignment.consumerType}:${assignment.consumerId}`;
                if (!canonicalAssignmentKeys.has(key)) {
                    assignmentsByConsumer.set(key, assignment);
                }
            }
        }
    }

    for (const legacyProcessorGroove of legacyYeastProcessorGrooves) {
        const templateId = templateIdMappings.get(`yeast:processor-template-${legacyProcessorGroove.templateIndex}`);
        if (!templateId) {
            continue;
        }
        const consumerId = getScopedGrooveConsumerId({
            ownerId: 'yeast-rack',
            localId: legacyProcessorGroove.processorId,
        });
        const assignment: GrooveTemplateAssignment = {
            consumerType: 'yeast-processor',
            consumerId,
            templateId,
            amount: legacyProcessorGroove.amount,
        };
        const key = `${assignment.consumerType}:${assignment.consumerId}`;
        if (!canonicalAssignmentKeys.has(key)) {
            assignmentsByConsumer.set(key, assignment);
        }
    }

    const grooves = sanitizeGrooveTemplateState({
        templates,
        assignments: [...assignmentsByConsumer.values()],
    });
    const strippedYeast = stripLegacyYeastProcessorGrooveParams(stripLegacyGrooveFields(value.yeast));
    let yeast: UnknownRecord | undefined;
    if (isRecord(strippedYeast) && Array.isArray(strippedYeast.processors)) {
        yeast = { processors: strippedYeast.processors };
    }

    return {
        ...value,
        yeast,
        toaster: stripLegacyGrooveFields(value.toaster),
        grooves,
    };
}

type NormalizeLegacyProjectDataOutput = unknown;

export function normalizeLegacyProjectData(value: unknown): NormalizeLegacyProjectDataOutput {
    if (!isRecord(value) || value.version !== 1) {
        return value;
    }
    const normalizedGrooves = normalizeGrooveFields(stripLegacyYeastViewState(value));
    if (normalizedGrooves.meta !== undefined || normalizedGrooves.arrangement !== undefined) {
        return migrateVersion1ProjectIdentity(normalizeAutomationFields(normalizedGrooves));
    }
    if (typeof normalizedGrooves.name !== 'string' || !isRecord(normalizedGrooves.tracks)) {
        return normalizedGrooves;
    }

    const markerState = isRecord(normalizedGrooves.markers) ? normalizedGrooves.markers : undefined;
    const markers = Array.isArray(markerState?.markers) ? markerState.markers : [];
    const arrangementId = 'legacy-arrangement';
    let arrangements = normalizedGrooves.arrangements;
    if (!Array.isArray(arrangements)) {
        arrangements = [
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
    }
    let activeArrangementId = arrangementId;
    if (typeof normalizedGrooves.activeArrangementId === 'string') {
        activeArrangementId = normalizedGrooves.activeArrangementId;
    }

    return migrateVersion1ProjectIdentity(
        normalizeAutomationFields({
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
            yeast: normalizedGrooves.yeast,
            mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
            markers,
            tempoMap: normalizedGrooves.tempoMap,
            timeSignatureMap: normalizedGrooves.timeSignatureMap,
            takeLanes: normalizedGrooves.takeLanes,
            sidechainRoutes: normalizedGrooves.sidechainRoutes,
            arrangements,
            activeArrangementId,
            history: { checkpoints: [] },
        })
    );
}
