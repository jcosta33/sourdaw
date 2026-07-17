import { describe, it, expect, beforeEach } from 'vitest';

import { loopStationStore } from '../loopStationStore';
import { punchRecordingStore } from '../punchRecordingStore';
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
            loopStationStore.update((state) => ({ ...state!, armed: true }));
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
            punchRecordingStore.update((state) => ({ ...state!, enabled: true }));
            expect(punchRecordingStore.value?.enabled).toBe(true);
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
