import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { tempoProjectRevisionStore } from '#/modules/Transport/stores';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { initProjectDirtyTracking } from '../initProjectDirtyTracking';

describe('project dirty tracking subscriptions', () => {
    let dispose: (() => void) | undefined;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('project dirty subscriptions');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        trackStore.set(structuredClone(defaultTrackState));
        dispose = initProjectDirtyTracking();
    });

    afterEach(() => {
        dispose?.();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    function publishTempoCommit(): void {
        tempoProjectRevisionStore.set((tempoProjectRevisionStore.value ?? 0) + 1);
    }

    it('marks dirty synchronously when a tempo commit notification arrives', () => {
        publishTempoCommit();
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('suppresses track and tempo dirty notifications throughout project loading', () => {
        projectStore.set({ ...projectStore.value!, loading: true });
        trackStore.set({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'loading-track', name: 'Loaded', kind: 'audio' })],
        });
        publishTempoCommit();
        expect(projectStore.value?.dirty).toBe(false);

        projectStore.set({ ...projectStore.value!, loading: false });
        expect(projectStore.value?.dirty).toBe(false);
        publishTempoCommit();
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('disposes both subscriptions without losing the existing track dirty observer', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'first-track', name: 'First', kind: 'audio' })],
        });
        expect(projectStore.value?.dirty).toBe(true);
        projectStore.set({ ...projectStore.value!, dirty: false });

        dispose?.();
        publishTempoCommit();
        expect(projectStore.value?.dirty).toBe(false);
        trackStore.set({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'second-track', name: 'Second', kind: 'audio' })],
        });
        expect(projectStore.value?.dirty).toBe(false);
    });
});
