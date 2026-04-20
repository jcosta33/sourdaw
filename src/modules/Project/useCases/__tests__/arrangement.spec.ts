import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { stopPlayback } from '#/modules/Transport/useCases';

import { arrangementStore } from '../../stores/arrangementStore';
import { switchArrangement } from '../arrangement/switchArrangement';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        stopPlayback: vi.fn(),
    };
});
vi.mock('../projectPersistence/saveProject/markDirty', () => ({ markDirty: vi.fn() }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        clearUndoHistory: vi.fn(),
    };
});

describe('switchArrangement', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('does not call transport or persistence collaborators when switching to the active arrangement', () => {
        const arrangementId = arrangementStore.value!.activeArrangementId;
        switchArrangement(arrangementId);

        expect(stopPlayback).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
    });
});
