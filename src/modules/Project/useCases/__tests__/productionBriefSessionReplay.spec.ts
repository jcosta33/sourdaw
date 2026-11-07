import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { clearHandlerRegistry } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    getExecutableCommandRegistrations,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';

/** The mirror writes after the history moves; the key reappearing is that write landing. */
async function awaitMirrorWrite(): Promise<void> {
    await vi.waitFor(() => {
        expect(sessionStorage.getItem(UNDO_SESSION_KEY)).not.toBeNull();
    });
}

function persistedActionTypes(): string[] {
    const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
    if (raw === null) {
        return [];
    }
    const persisted = JSON.parse(raw) as { past?: { action?: { type?: string } | null }[] };
    return (persisted.past ?? []).map((entry) => entry.action?.type ?? 'null');
}

// Registering setProductionBrief as an executable command must not give it a forward session
// contract: its replay authority is an in-memory set, so a reloaded brief entry could never be
// undone. A brief edit's undo entry keeps serializing to nothing, as it did before registration.
describe('production brief undo across a reload', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: createDefaultProductionBrief(100),
        });
        clearUndoHistory();
    });

    afterEach(() => {
        clearHandlerRegistry();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('registers the brief command hidden, with no forward session contract', () => {
        const registration = getExecutableCommandRegistrations().find(
            (candidate) => candidate.actionType === 'setProductionBrief'
        );

        expect(registration).toMatchObject({ discoverability: 'hidden', sessionReplay: 'none' });
    });

    it('keeps a brief edit out of the persisted undo session while it stays undoable in memory', async () => {
        const brief = {
            ...createDefaultProductionBrief(100),
            revision: 1,
            vision: 'Late-night record',
            updatedAt: 200,
        };
        sessionStorage.removeItem(UNDO_SESSION_KEY);

        await executeAppAction({ type: 'setProductionBrief', payload: { expectedRevision: 0, brief } });
        await awaitMirrorWrite();

        expect(projectStore.value?.productionBrief.vision).toBe('Late-night record');
        expect(persistedActionTypes()).not.toContain('setProductionBrief');

        await undo();

        expect(projectStore.value?.productionBrief.vision).toBeNull();
    });
});
