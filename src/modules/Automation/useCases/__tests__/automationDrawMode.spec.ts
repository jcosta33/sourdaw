import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';
import * as subject from '../automationDrawMode';

describe('automationDrawMode', () => {
    it('should export beginDrawSession', () => {
        expect(subject.beginDrawSession).toBeDefined();
        const time = typeof subject.beginDrawSession;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export endDrawSession', () => {
        expect(subject.endDrawSession).toBeDefined();
        const time = typeof subject.endDrawSession;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export isDrawSessionActive', () => {
        expect(subject.isDrawSessionActive).toBeDefined();
        const time = typeof subject.isDrawSessionActive;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export paintDrawPoint', () => {
        expect(subject.paintDrawPoint).toBeDefined();
        const time = typeof subject.paintDrawPoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    // Regression (Batch B fix 7): snapToGrid(beat, 0) was Math.round(beat/0)*0 = NaN,
    // poisoning the painted point's beat. A non-positive grid must leave the beat raw.
    describe('paintDrawPoint with a non-positive grid resolution', () => {
        beforeEach(() => {
            // paintDrawPoint defers its store write to a rAF; flush it synchronously.
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
                callback(0);
                return 1;
            });
            vi.stubGlobal('cancelAnimationFrame', () => {});
            const lane = createAutomationLane('t1', 'gain', 'Gain');
            lane.id = 'lane-draw';
            automationStore.set({ lanes: [lane] });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            automationStore.set({ lanes: [] });
            // Ensure no session leaks into the next test.
            if (subject.isDrawSessionActive()) {
                subject.endDrawSession();
            }
        });

        it('paints a finite, unsnapped beat when gridResolution is 0', () => {
            subject.beginDrawSession('lane-draw', 0, false);
            subject.paintDrawPoint(3.7, 0.5);
            subject.endDrawSession();

            const points = automationStore.value?.lanes.find((lane) => lane.id === 'lane-draw')?.points ?? [];
            expect(points).toHaveLength(1);
            expect(Number.isFinite(points[0]!.beat)).toBe(true);
            expect(points[0]!.beat).toBe(3.7);
        });
    });
});
