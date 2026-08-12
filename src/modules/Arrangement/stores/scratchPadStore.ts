/**
 * Scratch pad store — sections a user is rearranging before committing them
 * back to the main timeline.
 *
 * F6 — previously a bare `createStore({ initialData })` with no storage
 * adapter, so an in-progress scratch-pad arrangement vanished on reload.
 * Backed by the same `createStore` + `createAutomergeStorage` pattern #982
 * used for gain envelopes and VCA groups: this is durable in-progress project
 * data (a draft the user has not yet committed), not session-only scratch
 * state despite the name.
 */
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';

import { type ScratchPadSection } from '../models/ScratchPadSection';

const DOC_PREFIX_ROOT = 'root';

export type ScratchPadStoreState = {
    sections: ScratchPadSection[];
};

export const defaultScratchPadStoreState: ScratchPadStoreState = { sections: [] };

function isScratchPadSection(value: unknown): value is ScratchPadSection {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('startBeat' in value) || typeof value.startBeat !== 'number' || !Number.isFinite(value.startBeat)) {
        return false;
    }
    if (!('endBeat' in value) || typeof value.endBeat !== 'number' || !Number.isFinite(value.endBeat)) {
        return false;
    }
    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }
    if (!('color' in value) || typeof value.color !== 'string') {
        return false;
    }
    return 'order' in value && typeof value.order === 'number' && Number.isFinite(value.order);
}

const SCRATCH_PAD_SECTION_KEYS = ['id', 'startBeat', 'endBeat', 'name', 'color', 'order'] as const;

/**
 * Decode persisted scratch-pad sections from a project file or from the
 * `scratchPad` document slot — one decoder, so the two load paths cannot
 * drift. A section that does not decode is dropped rather than repaired.
 * Duplicated ids keep the first occurrence.
 */
export function sanitizeScratchPadSections(value: unknown): ScratchPadSection[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const sections: ScratchPadSection[] = [];
    const seenIds = new Set<string>();
    for (const candidate of value) {
        if (!isScratchPadSection(candidate) || seenIds.has(candidate.id)) {
            continue;
        }
        seenIds.add(candidate.id);
        sections.push({
            id: candidate.id,
            startBeat: candidate.startBeat,
            endBeat: candidate.endBeat,
            name: candidate.name,
            color: candidate.color,
            order: candidate.order,
        });
    }
    return sections;
}

function isExactScratchPadStoreState(value: unknown): value is ScratchPadStoreState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'sections') {
        return false;
    }
    if (!('sections' in value) || !Array.isArray(value.sections)) {
        return false;
    }

    const seenIds = new Set<string>();
    for (const candidate of value.sections) {
        if (!isScratchPadSection(candidate) || seenIds.has(candidate.id)) {
            return false;
        }
        if (Object.keys(candidate).length !== SCRATCH_PAD_SECTION_KEYS.length) {
            return false;
        }
        seenIds.add(candidate.id);
    }
    return true;
}

/**
 * Store-shaped decoder for the `scratchPad` document slot.
 *
 * Returns the argument itself when it already decodes exactly, so `createStore`
 * sees an identical value and does not write a sanitized copy back over a
 * shared document.
 */
function sanitizeScratchPadStoreState(value: unknown): ScratchPadStoreState {
    if (isExactScratchPadStoreState(value)) {
        return value;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !('sections' in value)) {
        return { sections: [] };
    }
    return { sections: sanitizeScratchPadSections(value.sections) };
}

export const scratchPadStore: Store<ScratchPadStoreState> = createStore<ScratchPadStoreState>({
    storage: createAutomergeStorage<ScratchPadStoreState>(DOC_PREFIX_ROOT, 'scratchPad', {
        // A document without the `scratchPad` slot resets the store to empty
        // rather than back-writing this replica's cache (audit CC-2).
        hydrateMissing: () => ({ sections: [] }),
    }),
    initialData: defaultScratchPadStoreState,
    sanitize: sanitizeScratchPadStoreState,
});
