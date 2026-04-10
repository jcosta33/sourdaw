import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { getRemainingDuration } from './getRemainingDuration';

const item = (id: string, dur: number, gap: number): SetlistItem => ({
    id,
    name: id,
    projectPath: null,
    bpm: null,
    timeSignature: null,
    estimatedDuration: dur,
    notes: '',
    programChange: null,
    color: '#000',
    autoStop: true,
    gapSeconds: gap,
    markers: [],
});

describe('getRemainingDuration', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('sums estimatedDuration + gap from currentIndex onward', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('a', 10, 2), item('b', 20, 1)],
            currentIndex: 1,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 0,
        };
        injectDependencies(getRemainingDuration, {
            setlistStore: { value: state, set: vi.fn() } as never,
        });
        expect(getRemainingDuration()).toBe(21);
    });
});
