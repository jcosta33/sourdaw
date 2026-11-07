import { SEMANTIC_COMMAND_LIST_ROLE_FAMILIES } from '../models/SemanticCommandList';
import {
    type ScheduledVibeRunBatch,
    type ScheduledVibeRunPlan,
    type VibeRunBatchTarget,
    type VibeRunExpectedDelta,
} from '../models/VibeRunPlan';

const DIRECTIONS: readonly VibeRunExpectedDelta['direction'][] = ['increase', 'decrease', 'hold'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function readTexts(value: unknown): string[] | null {
    return Array.isArray(value) && value.every(isText) ? [...value] : null;
}

function readEvery<Entry>(value: unknown, read: (entry: unknown) => Entry | null): Entry[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const entries: Entry[] = [];
    for (const candidate of value) {
        const entry = read(candidate);
        if (entry === null) {
            return null;
        }
        entries.push(entry);
    }
    return entries;
}

function readExpectedDelta(value: unknown): VibeRunExpectedDelta | null {
    if (!isRecord(value) || !isText(value.descriptor) || !isText(value.metric)) {
        return null;
    }
    const { band, direction: storedDirection } = value;
    const direction = DIRECTIONS.find((entry) => entry === storedDirection);
    if (direction === undefined || (band !== null && !isText(band))) {
        return null;
    }
    return { descriptor: value.descriptor, metric: value.metric, band, direction };
}

function readTarget(value: unknown): VibeRunBatchTarget | null {
    if (!isRecord(value) || !isText(value.targetId) || !isCount(value.commandCount)) {
        return null;
    }
    const recipeIds = readTexts(value.recipeIds);
    const expectedDeltas = readEvery(value.expectedDeltas, readExpectedDelta);
    if (recipeIds === null || recipeIds.length === 0 || expectedDeltas === null) {
        return null;
    }
    return { targetId: value.targetId, recipeIds, expectedDeltas, commandCount: value.commandCount };
}

function readBatch(value: unknown): ScheduledVibeRunBatch | null {
    if (!isRecord(value) || !isText(value.id) || !isCount(value.ordinal) || !isCount(value.commandCount)) {
        return null;
    }
    const objective = isRecord(value.objective) ? value.objective : null;
    const descriptors = readTexts(objective?.descriptors);
    const role = SEMANTIC_COMMAND_LIST_ROLE_FAMILIES.find((family) => family === objective?.role);
    const targetIds = readTexts(value.targetIds);
    const targets = readEvery(value.targets, readTarget);
    if (
        descriptors === null ||
        role === undefined ||
        targetIds === null ||
        targets === null ||
        targets.length === 0 ||
        targets.length !== targetIds.length ||
        targets.some((target, index) => target.targetId !== targetIds[index]) ||
        targets.reduce((total, target) => total + target.commandCount, 0) !== value.commandCount
    ) {
        return null;
    }
    return {
        id: value.id,
        ordinal: value.ordinal,
        objective: { descriptors, role },
        targetIds,
        targets,
        commandCount: value.commandCount,
    };
}

/**
 * The plan a `vibe-run` schedule stored, read whole or not at all: its batches must run 1..N in order
 * and each must state its own targets, recipes and the commands they expand to, or a later batch could
 * be grounded from a plan nobody made.
 */
export function readScheduledVibeRunPlan(serialized: string): ScheduledVibeRunPlan | null {
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return null;
    }
    if (!isRecord(value) || value.schemaVersion !== 1 || !isCount(value.briefRevision)) {
        return null;
    }
    const batches = readEvery(value.batches, readBatch);
    if (batches === null || batches.length === 0 || batches.some((batch, index) => batch.ordinal !== index + 1)) {
        return null;
    }
    return { schemaVersion: 1, briefRevision: value.briefRevision, batches };
}
