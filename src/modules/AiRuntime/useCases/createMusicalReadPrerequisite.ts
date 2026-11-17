import {
    musicalContentBindingIsCurrent,
    resolveMusicalContentReadScope,
    type captureMusicalContentBinding,
} from '#/modules/Project/useCases';

import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../transformers/toolCallParser';

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ReadWindow = ReturnType<typeof resolveMusicalContentReadScope>[number];

type PageState = { offset: number; total: number | undefined };

function matchesReadCall(call: ToolCallResult, window: ReadWindow, cursor: string | undefined): boolean {
    if (call.name !== 'project.query' || call.arguments.type !== 'musical-content' || !record(call.arguments.filters)) {
        return false;
    }
    const filters = call.arguments.filters;
    return (
        filters.stableId === window.clipId &&
        filters.startBeat === window.startBeat &&
        filters.endBeat === window.endBeat &&
        (record(call.arguments.page) ? call.arguments.page.cursor : undefined) === cursor
    );
}

function admittedPage(raw: ApplicationToolReceipt, admitted: ApplicationToolReceipt, state: PageState) {
    if (
        raw.status !== 'success' ||
        admitted.status !== 'success' ||
        JSON.stringify(raw) !== JSON.stringify(admitted) ||
        admitted.warnings.length > 0 ||
        !record(admitted.data) ||
        admitted.data.queryType !== 'musical-content' ||
        !record(admitted.data.page) ||
        admitted.data.page.offset !== state.offset ||
        typeof admitted.data.page.total !== 'number' ||
        !Array.isArray(admitted.data.items) ||
        (state.total !== undefined && state.total !== admitted.data.page.total)
    ) {
        return null;
    }
    const total = admitted.data.page.total;
    const { items, nextCursor: next } = admitted.data;
    if (
        (next !== null && typeof next !== 'string') ||
        state.offset + items.length > total ||
        (next === null && state.offset + items.length !== total) ||
        (next !== null && items.length === 0)
    ) {
        return null;
    }
    return { items, next, total };
}

function selectedOwners(items: unknown[], window: ReadWindow, found: Set<string>): void {
    for (const item of items) {
        if (!record(item) || item.kind !== 'note' || item.selected !== true) {
            continue;
        }
        for (const owner of window.owners) {
            if (
                item.viewId === owner.viewId &&
                item.ownerClipId === owner.ownerClipId &&
                item.noteId === owner.storedNoteId &&
                (item.takeId ?? undefined) === owner.takeId &&
                (owner.occurrenceIndex === undefined || item.occurrenceIndex === owner.occurrenceIndex)
            ) {
                found.add(owner.viewId);
            }
        }
    }
}

/** Tracks only complete admitted real query pages; the read grants no edit authority. */
export function createMusicalReadPrerequisite(
    authority: CreativeRequestAuthority,
    binding: ReturnType<typeof captureMusicalContentBinding>
) {
    if (authority.mode !== 'edit' || !authority.editDimensions.includes('midi-content')) {
        return null;
    }
    if (
        authority.targets.every((target) => target.objectType === 'track') &&
        authority.creationSlots.some((slot) => slot.objectType === 'notes' || slot.objectType === 'clip')
    ) {
        return null;
    }
    if (authority.targets.length === 0 || authority.targets.some((target) => target.objectType === 'track')) {
        throw new Error('Musical read target unavailable');
    }
    const clipIds = [...new Set(authority.targets.flatMap((target) => target.objectIds))];
    const windows = resolveMusicalContentReadScope(binding, clipIds);
    const captured = { binding, windows, authorityId: authority.authorityId };
    let index = 0;
    let cursor: string | undefined;
    let offset = 0;
    let total: number | undefined;
    let found = new Set<string>();
    return {
        completed() {
            return index === windows.length && musicalContentBindingIsCurrent(binding)
                ? structuredClone(captured)
                : undefined;
        },
        hint() {
            const window = windows[index];
            if (!window) {
                return null;
            }
            const hint: { clipId: string; startBeat: number; endBeat: number; cursor?: string } = {
                clipId: window.clipId,
                startBeat: window.startBeat,
                endBeat: window.endBeat,
            };
            if (cursor) {
                hint.cursor = cursor;
            }
            return hint;
        },
        current() {
            return musicalContentBindingIsCurrent(binding);
        },
        admit(call: ToolCallResult, raw: ApplicationToolReceipt, admitted: ApplicationToolReceipt) {
            const window = windows[index];
            if (!window || !matchesReadCall(call, window, cursor)) {
                return;
            }
            const page = admittedPage(raw, admitted, { offset, total });
            if (page === null) {
                return;
            }
            const { items, next } = page;
            total = page.total;
            selectedOwners(items, window, found);
            offset += items.length;
            if (next !== null) {
                cursor = next;
                return;
            }
            if (found.size !== window.owners.length) {
                return;
            }
            index++;
            cursor = undefined;
            offset = 0;
            total = undefined;
            found = new Set<string>();
        },
    };
}
