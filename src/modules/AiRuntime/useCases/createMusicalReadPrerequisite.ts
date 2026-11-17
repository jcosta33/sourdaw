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
            if (
                !window ||
                call.name !== 'project.query' ||
                call.arguments.type !== 'musical-content' ||
                !record(call.arguments.filters) ||
                call.arguments.filters.stableId !== window.clipId ||
                call.arguments.filters.startBeat !== window.startBeat ||
                call.arguments.filters.endBeat !== window.endBeat ||
                (record(call.arguments.page) ? call.arguments.page.cursor : undefined) !== cursor ||
                raw.status !== 'success' ||
                admitted.status !== 'success' ||
                JSON.stringify(raw) !== JSON.stringify(admitted) ||
                admitted.warnings.length > 0 ||
                !record(admitted.data) ||
                admitted.data.queryType !== 'musical-content' ||
                !record(admitted.data.page) ||
                admitted.data.page.offset !== offset ||
                typeof admitted.data.page.total !== 'number' ||
                !Array.isArray(admitted.data.items) ||
                (total !== undefined && total !== admitted.data.page.total)
            ) {
                return;
            }
            const items = admitted.data.items;
            const next = admitted.data.nextCursor;
            if (
                (next !== null && typeof next !== 'string') ||
                offset + items.length > admitted.data.page.total ||
                (next === null && offset + items.length !== admitted.data.page.total) ||
                (next !== null && items.length === 0)
            ) {
                return;
            }
            total = admitted.data.page.total;
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
