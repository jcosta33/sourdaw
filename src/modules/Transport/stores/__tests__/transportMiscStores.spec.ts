import { describe, it, expect, beforeEach } from 'vitest';

import { loopStationStore } from '../loopStationStore';
import { punchRecordingStore } from '../punchRecordingStore';
import { setlistStore } from '../setlistStore';
import { timeSignatureMapStore } from '../timeSignatureMapStore';

describe('Transport Misc Stores', () => {
    describe('loopStationStore', () => {
        beforeEach(() => {
            loopStationStore.set({
                slots: [],
                sceneCount: 8,
                activeScene: 0,
                armed: false,
                syncToTransport: true,
                fixedLoopLength: 0,
            });
        });

        it('should have initial state', () => {
            expect(loopStationStore.value?.slots).toHaveLength(0);
            expect(loopStationStore.value?.sceneCount).toBe(8);
        });

        it('should update state', () => {
            loopStationStore.update((s) => ({ ...s!, armed: true }));
            expect(loopStationStore.value?.armed).toBe(true);
        });
    });

    describe('punchRecordingStore', () => {
        beforeEach(() => {
            punchRecordingStore.set({
                captures: [],
                defaultPreRoll: 4,
                defaultPostRoll: 2,
                defaultCrossfade: 0.25,
                enabled: false,
            });
        });

        it('should have initial state', () => {
            expect(punchRecordingStore.value?.captures).toHaveLength(0);
            expect(punchRecordingStore.value?.enabled).toBe(false);
        });

        it('should update state', () => {
            punchRecordingStore.update((s) => ({ ...s!, enabled: true }));
            expect(punchRecordingStore.value?.enabled).toBe(true);
        });
    });

    describe('setlistStore', () => {
        beforeEach(() => {
            setlistStore.set({
                name: 'Untitled Setlist',
                items: [],
                currentIndex: 0,
                autoAdvance: false,
                countInBars: 1,
                totalDuration: 0,
            });
        });

        it('should have initial state', () => {
            expect(setlistStore.value?.items).toHaveLength(0);
            expect(setlistStore.value?.name).toBe('Untitled Setlist');
        });

        it('should update state', () => {
            setlistStore.update((s) => ({ ...s!, name: 'Tour 2026' }));
            expect(setlistStore.value?.name).toBe('Tour 2026');
        });
    });

    describe('timeSignatureMapStore', () => {
        beforeEach(() => {
            timeSignatureMapStore.set({ changes: [] });
        });

        it('should have initial state', () => {
            expect(timeSignatureMapStore.value?.changes).toHaveLength(0);
        });

        it('should update state', () => {
            const change = { id: '1', beat: 0, numerator: 3, denominator: 4 };
            timeSignatureMapStore.set({ changes: [change] });
            expect(timeSignatureMapStore.value?.changes).toHaveLength(1);
            expect(timeSignatureMapStore.value?.changes[0]).toEqual(change);
        });
    });
});
