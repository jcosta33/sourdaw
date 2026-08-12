/**
 * Groove template store — timing-offset templates and the project's active
 * groove selection.
 *
 * F6 — previously a bare `createStore({ initialData })` with no storage
 * adapter, so per-project groove settings (which template is active, its
 * intensity) vanished on reload. Backed by the same `createStore` +
 * `createAutomergeStorage` pattern #982 used for gain envelopes and VCA
 * groups — the type's own doc comment already called this "project-wide",
 * so session-only was never the intent.
 */
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';

const DOC_PREFIX_ROOT = 'root';

/**
 * Groove template — defined as a sequence of timing offsets (in beats).
 * R-H4: Groove templates library.
 */
export type GrooveTemplate = {
    id: string;
    name: string;
    /** Sequence of micro-timing offsets (-0.25 to 0.25 beats) */
    offsets: number[];
    resolution: number; // e.g., 0.25 for 16th notes
};

export type GrooveState = {
    templates: GrooveTemplate[];
    /** Project-wide groove settings */
    projectGrooveId: string | null;
    projectGrooveIntensity: number; // 0 to 1
};

export const defaultGrooveState: GrooveState = {
    templates: [
        {
            id: 'swing-16th',
            name: 'Swing 16th',
            offsets: [0, 0.05, 0, 0.05],
            resolution: 0.25,
        },
    ],
    projectGrooveId: null,
    projectGrooveIntensity: 0.5,
};

function isGrooveTemplate(value: unknown): value is GrooveTemplate {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }
    if (
        !('offsets' in value) ||
        !Array.isArray(value.offsets) ||
        !value.offsets.every((offset) => typeof offset === 'number' && Number.isFinite(offset))
    ) {
        return false;
    }
    return 'resolution' in value && typeof value.resolution === 'number' && Number.isFinite(value.resolution);
}

const GROOVE_TEMPLATE_KEYS = ['id', 'name', 'offsets', 'resolution'] as const;

/**
 * Decode persisted groove templates from a project file or from the
 * `groove` document slot — one decoder, so the two load paths cannot drift.
 * A template that does not decode is dropped rather than repaired.
 * Duplicated ids keep the first occurrence.
 */
export function sanitizeGrooveTemplates(value: unknown): GrooveTemplate[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const templates: GrooveTemplate[] = [];
    const seenIds = new Set<string>();
    for (const candidate of value) {
        if (!isGrooveTemplate(candidate) || seenIds.has(candidate.id)) {
            continue;
        }
        seenIds.add(candidate.id);
        templates.push({
            id: candidate.id,
            name: candidate.name,
            offsets: [...candidate.offsets],
            resolution: candidate.resolution,
        });
    }
    return templates;
}

function isExactGrooveState(value: unknown): value is GrooveState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (
        keys.length !== 3 ||
        !('templates' in value) ||
        !('projectGrooveId' in value) ||
        !('projectGrooveIntensity' in value)
    ) {
        return false;
    }
    if (!Array.isArray(value.templates)) {
        return false;
    }
    if (typeof value.projectGrooveId !== 'string' && value.projectGrooveId !== null) {
        return false;
    }
    if (typeof value.projectGrooveIntensity !== 'number' || !Number.isFinite(value.projectGrooveIntensity)) {
        return false;
    }

    const seenIds = new Set<string>();
    for (const candidate of value.templates) {
        if (!isGrooveTemplate(candidate) || seenIds.has(candidate.id)) {
            return false;
        }
        if (Object.keys(candidate).length !== GROOVE_TEMPLATE_KEYS.length) {
            return false;
        }
        seenIds.add(candidate.id);
    }
    return true;
}

/**
 * Store-shaped decoder for the `groove` document slot.
 *
 * Returns the argument itself when it already decodes exactly, so `createStore`
 * sees an identical value and does not write a sanitized copy back over a
 * shared document.
 */
function sanitizeGrooveState(value: unknown): GrooveState {
    if (isExactGrooveState(value)) {
        return value;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return defaultGrooveState;
    }
    const templates = 'templates' in value ? sanitizeGrooveTemplates(value.templates) : [];
    const projectGrooveId =
        'projectGrooveId' in value && (typeof value.projectGrooveId === 'string' || value.projectGrooveId === null)
            ? value.projectGrooveId
            : null;
    const projectGrooveIntensity =
        'projectGrooveIntensity' in value &&
        typeof value.projectGrooveIntensity === 'number' &&
        Number.isFinite(value.projectGrooveIntensity)
            ? value.projectGrooveIntensity
            : 0.5;
    return { templates, projectGrooveId, projectGrooveIntensity };
}

export const grooveStore: Store<GrooveState> = createStore<GrooveState>({
    storage: createAutomergeStorage<GrooveState>(DOC_PREFIX_ROOT, 'groove', {
        // A document without the `groove` slot resets the store to the
        // built-in default template rather than back-writing this replica's
        // cache (audit CC-2).
        hydrateMissing: () => defaultGrooveState,
    }),
    initialData: defaultGrooveState,
    sanitize: sanitizeGrooveState,
});
