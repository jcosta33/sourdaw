/**
 * Setlist Management
 *
 * Auto-stop, program changes, backing track queues, and
 * live performance management for setlist-based workflows.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type SetlistItem = {
    id: string;
    /** Song/cue name */
    name: string;
    /** Project file path to load (null = stays in current project) */
    projectPath: string | null;
    /** BPM for this item (null = use project tempo) */
    bpm: number | null;
    /** Time signature */
    timeSignature: { numerator: number; denominator: number } | null;
    /** Duration in seconds (estimated, for display) */
    estimatedDuration: number;
    /** Notes (stage directions, reminders) */
    notes: string;
    /** MIDI program change to send on item start */
    programChange: { channel: number; program: number } | null;
    /** Color label */
    color: string;
    /** Auto-stop after this item finishes */
    autoStop: boolean;
    /** Gap in seconds before next item auto-starts */
    gapSeconds: number;
    /** Custom markers within this setlist item (beat positions) */
    markers: Array<{ beatOffset: number; name: string }>;
};

export type SetlistState = {
    name: string;
    items: SetlistItem[];
    currentIndex: number;
    /** Is the setlist playing through automatically? */
    autoAdvance: boolean;
    /** Count-in bars before each item */
    countInBars: number;
    /** Total estimated duration */
    totalDuration: number;
};

export const setlistStore = new Store<SetlistState>(logger, {
    initialData: {
        name: 'Untitled Setlist',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
        totalDuration: 0,
    },
});

let itemId = 1;

const ITEM_COLORS = [
    'oklch(0.65 0.12 200)', 'oklch(0.65 0.12 140)', 'oklch(0.65 0.12 280)',
    'oklch(0.65 0.12 340)', 'oklch(0.65 0.12 60)', 'oklch(0.65 0.12 20)',
];

// ── CRUD ──────────────────────────────────────────────────────────────

export function addSetlistItem(name: string, estimatedDuration: number = 180): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }

    const item: SetlistItem = {
        id: `sli-${itemId++}`,
        name,
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration,
        notes: '',
        programChange: null,
        color: ITEM_COLORS[state.items.length % ITEM_COLORS.length]!,
        autoStop: true,
        gapSeconds: 2,
        markers: [],
    };

    setlistStore.set({
        ...state,
        items: [...state.items, item],
        totalDuration: state.totalDuration + estimatedDuration,
    });
}

export function removeSetlistItem(id: string): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    const removed = state.items.find((i) => i.id === id);
    setlistStore.set({
        ...state,
        items: state.items.filter((i) => i.id !== id),
        totalDuration: state.totalDuration - (removed?.estimatedDuration ?? 0),
    });
}

export function updateSetlistItem(id: string, updates: Partial<Omit<SetlistItem, 'id'>>): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({
        ...state,
        items: state.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
    });
}

export function reorderSetlistItems(fromIndex: number, toIndex: number): void {
    const state = setlistStore.value;
    if (!state || fromIndex === toIndex) {
        return;
    }
    const items = [...state.items];
    const [moved] = items.splice(fromIndex, 1);
    if (moved) {
        items.splice(toIndex, 0, moved);
    }
    setlistStore.set({ ...state, items });
}

// ── Navigation ────────────────────────────────────────────────────────

export function goToItem(index: number): void {
    const state = setlistStore.value;
    if (!state || index < 0 || index >= state.items.length) {
        return;
    }

    setlistStore.set({ ...state, currentIndex: index });

    const item = state.items[index];
    if (!item) {
        return;
    }

    // Dispatch program change if configured
    if (item.programChange) {
        document.dispatchEvent(
            new CustomEvent('webdaw:midi-out', {
                detail: {
                    type: 'programChange',
                    channel: item.programChange.channel,
                    program: item.programChange.program,
                },
            })
        );
    }
}

export function nextItem(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    goToItem(state.currentIndex + 1);
}

export function previousItem(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    goToItem(state.currentIndex - 1);
}

// ── Setlist Settings ──────────────────────────────────────────────────

export function renameSetlist(name: string): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({ ...state, name });
}

export function toggleAutoAdvance(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({ ...state, autoAdvance: !state.autoAdvance });
}

export function setCountIn(bars: number): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({ ...state, countInBars: bars });
}

// ── Queries ──────────────────────────────────────────────────────────

export function getCurrentItem(): SetlistItem | null {
    const state = setlistStore.value;
    if (!state || state.items.length === 0) {
        return null;
    }
    return state.items[state.currentIndex] ?? null;
}

export function getRemainingDuration(): number {
    const state = setlistStore.value;
    if (!state) {
        return 0;
    }
    return state.items
        .slice(state.currentIndex)
        .reduce((sum, item) => sum + item.estimatedDuration + item.gapSeconds, 0);
}

export function getSetlistProgress(): { current: number; total: number; percent: number } {
    const state = setlistStore.value;
    if (!state || state.items.length === 0) {
        return { current: 0, total: 0, percent: 0 };
    }
    return {
        current: state.currentIndex + 1,
        total: state.items.length,
        percent: ((state.currentIndex + 1) / state.items.length) * 100,
    };
}
