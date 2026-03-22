/**
 * Scratch Pad Use Cases.
 *
 * CRUD + capture/commit operations for the arrangement scratch pad.
 * The scratch pad is a Studio One–style alternative arrangement workspace
 * where users rearrange sections freely without affecting the main timeline.
 */

import { scratchPadStore } from '../stores/scratchPadStore';
import { markerStore } from '../stores/markerStore';
import { createScratchPadSection } from '../models/ScratchPadSection';

// Re-export types as DTOs for cross-module use
export type { ScratchPadSection } from '../models/ScratchPadSection';

// ── CRUD ──────────────────────────────────────────────────────────────────

export function addScratchPadSection(
    startBeat: number,
    endBeat: number,
    name: string,
    color: string
): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const order = state.sections.length;
    scratchPadStore.set({
        sections: [...state.sections, createScratchPadSection(startBeat, endBeat, name, color, order)],
    });
}

export function removeScratchPadSection(sectionId: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    // Remove and recompute order
    const remaining = state.sections
        .filter((s) => s.id !== sectionId)
        .map((s, i) => ({ ...s, order: i }));
    scratchPadStore.set({ sections: remaining });
}

export function renameScratchPadSection(sectionId: string, name: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({
        sections: state.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)),
    });
}

export function setScratchPadSectionColor(sectionId: string, color: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({
        sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)),
    });
}

export function reorderScratchPadSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }

    const sections = [...state.sections].sort((a, b) => a.order - b.order);
    const index = sections.findIndex((s) => s.id === sectionId);
    if (index < 0) {
        return;
    }

    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) {
        return;
    }

    // Swap the two sections and recalculate beats based on new order
    const temp = sections[index]!;
    sections[index] = sections[targetIndex]!;
    sections[targetIndex] = temp;

    // Recalculate start/end beats sequentially from beat 0
    let beat = 0;
    const reordered = sections.map((s, i) => {
        const duration = s.endBeat - s.startBeat;
        const updated = { ...s, order: i, startBeat: beat, endBeat: beat + duration };
        beat += duration;
        return updated;
    });

    scratchPadStore.set({ sections: reordered });
}

export function clearScratchPad(): void {
    scratchPadStore.set({ sections: [] });
}

// ── Capture & Commit ──────────────────────────────────────────────────────

/**
 * Capture the current arrangement sections into the scratch pad.
 * Replaces whatever is currently in the scratch pad.
 */
export function captureArrangementToScratchPad(): void {
    const markerState = markerStore.value;
    if (!markerState || markerState.sections.length === 0) {
        return;
    }

    const sorted = [...markerState.sections].sort((a, b) => a.startBeat - b.startBeat);
    const scratchSections = sorted.map((s, i) =>
        createScratchPadSection(s.startBeat, s.endBeat, s.name, s.color, i)
    );
    scratchPadStore.set({ sections: scratchSections });
}

/**
 * Commit the scratch pad arrangement back to the main timeline.
 * Replaces the main arrangement sections with the scratch pad order.
 */
export function commitScratchPadToArrangement(): void {
    const padState = scratchPadStore.value;
    const markerState = markerStore.value;
    if (!padState || !markerState || padState.sections.length === 0) {
        return;
    }

    // Rebuild arrangement sections from scratch pad order
    const newSections = padState.sections
        .sort((a, b) => a.order - b.order)
        .map((s, _i) => ({
            id: `section-committed-${crypto.randomUUID().slice(0, 8)}`,
            startBeat: s.startBeat,
            endBeat: s.endBeat,
            name: s.name,
            color: s.color,
        }));

    markerStore.set({ ...markerState, sections: newSections });
}
