export const GROOVE_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const STRAIGHT_GROOVE_TEMPLATE_ID = 'groove-straight';

export const GROOVE_SUBDIVISIONS = ['1/8', '1/16', '1/32', '1/16T'] as const;

export type GrooveSubdivision = (typeof GROOVE_SUBDIVISIONS)[number];

export type GrooveTemplateSlot = {
    index: number;
    timingOffset: number;
    dynamicsOffset: number;
};

export type GrooveTemplateProvenance =
    | { type: 'builtin'; sourceId: string }
    | { type: 'user'; sourceId: string }
    | { type: 'midi-clip'; sourceId: string; analyzerVersion: number }
    | { type: 'legacy'; sourceId: string };

export type GrooveTemplate = {
    id: string;
    name: string;
    schemaVersion: typeof GROOVE_TEMPLATE_SCHEMA_VERSION;
    subdivision: GrooveSubdivision;
    slots: GrooveTemplateSlot[];
    provenance: GrooveTemplateProvenance;
};

type ResolveGrooveTemplateNameInput = {
    requestedName: string;
    templates: ReadonlyArray<Pick<GrooveTemplate, 'id' | 'name'>>;
    ignoreTemplateId?: string;
};

const TEMPLATE_KEYS = ['id', 'name', 'schemaVersion', 'subdivision', 'slots', 'provenance'] as const;
const SLOT_KEYS = ['index', 'timingOffset', 'dynamicsOffset'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isGrooveTemplateSlot(value: unknown): value is GrooveTemplateSlot {
    return (
        isRecord(value) &&
        hasExactKeys(value, SLOT_KEYS) &&
        Number.isInteger(value.index) &&
        Number(value.index) >= 0 &&
        isFiniteNumber(value.timingOffset) &&
        Number(value.timingOffset) >= -0.5 &&
        Number(value.timingOffset) <= 0.5 &&
        isFiniteNumber(value.dynamicsOffset) &&
        Number(value.dynamicsOffset) >= -1 &&
        Number(value.dynamicsOffset) <= 1
    );
}

function isGrooveTemplateProvenance(value: unknown): value is GrooveTemplateProvenance {
    if (!isRecord(value) || typeof value.sourceId !== 'string' || value.sourceId.length === 0) {
        return false;
    }
    if (value.type === 'midi-clip') {
        return (
            hasExactKeys(value, ['type', 'sourceId', 'analyzerVersion']) &&
            Number.isInteger(value.analyzerVersion) &&
            Number(value.analyzerVersion) > 0
        );
    }
    return (
        (value.type === 'builtin' || value.type === 'user' || value.type === 'legacy') &&
        hasExactKeys(value, ['type', 'sourceId'])
    );
}

export function createStraightGrooveTemplate(): GrooveTemplate {
    return {
        id: STRAIGHT_GROOVE_TEMPLATE_ID,
        name: 'Straight',
        schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
        subdivision: '1/16',
        slots: [],
        provenance: { type: 'builtin', sourceId: 'straight' },
    };
}

export function resolveGrooveTemplateNameCollision({
    requestedName,
    templates,
    ignoreTemplateId,
}: ResolveGrooveTemplateNameInput): string {
    const baseName = requestedName.trim() || 'Untitled groove';
    const occupiedNames = new Set(
        templates
            .filter((template) => template.id !== ignoreTemplateId)
            .map((template) => template.name.toLocaleLowerCase())
    );
    if (!occupiedNames.has(baseName.toLocaleLowerCase())) {
        return baseName;
    }

    let suffix = 2;
    while (occupiedNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) {
        suffix += 1;
    }
    return `${baseName} ${suffix}`;
}

export function isGrooveTemplate(value: unknown): value is GrooveTemplate {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, TEMPLATE_KEYS) ||
        typeof value.id !== 'string' ||
        value.id.length === 0 ||
        typeof value.name !== 'string' ||
        value.name.trim().length === 0 ||
        value.schemaVersion !== GROOVE_TEMPLATE_SCHEMA_VERSION ||
        !GROOVE_SUBDIVISIONS.includes(value.subdivision as GrooveSubdivision) ||
        !Array.isArray(value.slots) ||
        !value.slots.every(isGrooveTemplateSlot) ||
        new Set(value.slots.map((slot) => slot.index)).size !== value.slots.length ||
        !isGrooveTemplateProvenance(value.provenance)
    ) {
        return false;
    }

    const subdivision = value.subdivision as GrooveSubdivision;
    if (value.slots.some((slot) => slot.index >= getGrooveSubdivisionSlotCount(subdivision))) {
        return false;
    }
    if (value.id !== STRAIGHT_GROOVE_TEMPLATE_ID) {
        return true;
    }
    return (
        value.name === 'Straight' &&
        subdivision === '1/16' &&
        value.slots.length === 0 &&
        value.provenance.type === 'builtin' &&
        value.provenance.sourceId === 'straight'
    );
}

export function getGrooveSubdivisionStepBeats(subdivision: GrooveSubdivision): number {
    switch (subdivision) {
        case '1/8':
            return 0.5;
        case '1/16':
            return 0.25;
        case '1/32':
            return 0.125;
        case '1/16T':
            return 1 / 6;
    }
    return 0.25;
}

export function getGrooveSubdivisionSlotCount(subdivision: GrooveSubdivision): number {
    return Math.round(4 / getGrooveSubdivisionStepBeats(subdivision));
}
