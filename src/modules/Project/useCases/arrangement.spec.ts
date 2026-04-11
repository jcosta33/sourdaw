import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { arrangementStore } from '../stores/arrangementStore';
import { switchArrangement } from './arrangement/switchArrangement';

describe('switchArrangement', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not call transport or persistence collaborators when switching to the active arrangement', () => {
        const stopPlayback = vi.fn();
        const markDirty = vi.fn();
        injectDependencies(switchArrangement, { stopPlayback, markDirty });

        const arrangementId = arrangementStore.value!.activeArrangementId;
        switchArrangement(arrangementId);

        expect(stopPlayback).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
    });
});
