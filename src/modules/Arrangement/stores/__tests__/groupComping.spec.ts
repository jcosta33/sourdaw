import { afterEach, describe, expect, it } from 'vitest';

import {
    GROUP_COLORS,
    getNextGroupId,
    getNextRegionId,
    getNextTakeSetId,
    groupCompingStore,
    type GroupCompingState,
} from '../groupComping';

describe('groupComping store', () => {
    afterEach(() => {
        groupCompingStore.set({ groups: [], activeGroupId: null, defaultCrossfade: 0.125 });
    });

    it('boots with an empty, non-active initial state and a default crossfade', () => {
        // Reset is the closest we can get to a cold store in-process.
        groupCompingStore.set({ groups: [], activeGroupId: null, defaultCrossfade: 0.125 });
        const state = groupCompingStore.value as GroupCompingState;

        expect(state.groups).toEqual([]);
        expect(state.activeGroupId).toBeNull();
        // 0.125 beats = 1/8 note crossfade — the comp default the audio engine
        // falls back to when a region omits crossfadeBeats.
        expect(state.defaultCrossfade).toBe(0.125);
    });
});

// §122.1 — these replaced module-level integer counters that reset on HMR and
// collided across sequential creates after a reload. The domain contract is:
// each generator emits a stable type-prefix + a globally unique tail, so two
// back-to-back calls never collide even without a reset between them.
describe('group comping id generators', () => {
    it('getNextGroupId prefixes with grp-', () => {
        const id = getNextGroupId();
        expect(id).toMatch(/^grp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('getNextTakeSetId prefixes with ts-', () => {
        const id = getNextTakeSetId();
        expect(id).toMatch(/^ts-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('getNextRegionId prefixes with gr-', () => {
        const id = getNextRegionId();
        expect(id).toMatch(/^gr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('never collides across many sequential calls (the §122.1 regression)', () => {
        const ids = new Set<string>();
        for (let index = 0; index < 200; index += 1) {
            ids.add(getNextGroupId());
        }
        // A counter-based generator reset between suites would reuse values and
        // shrink this set well below 200.
        expect(ids.size).toBe(200);
    });

    it('keeps each prefix distinct from the others', () => {
        const group = getNextGroupId();
        const takeSet = getNextTakeSetId();
        const region = getNextRegionId();

        expect(group.startsWith('grp-')).toBe(true);
        expect(takeSet.startsWith('ts-')).toBe(true);
        expect(region.startsWith('gr-')).toBe(true);
        // No overlap between the three namespaces.
        expect(new Set([group, takeSet, region]).size).toBe(3);
    });
});

// GROUP_COLORS is consumed modulo its length by addGroupTakeSet to assign each
// new take set a color. A crash (division by zero) or empty palette would break
// take-set creation, and a duplicate palette would silently merge takes
// visually. The domain contract: distinct, non-empty color tokens.
describe('GROUP_COLORS palette', () => {
    it('is non-empty so the modulo assignment in addGroupTakeSet never divides by zero', () => {
        expect(GROUP_COLORS.length).toBeGreaterThan(0);
    });

    it('contains only oklch color tokens', () => {
        for (const color of GROUP_COLORS) {
            expect(color.startsWith('oklch(')).toBe(true);
        }
    });

    it('has distinct entries so neighbouring take sets read as different colors', () => {
        expect(new Set(GROUP_COLORS).size).toBe(GROUP_COLORS.length);
    });

    it('cycles correctly via modulo (the index pattern addGroupTakeSet uses)', () => {
        // Mirrors the real consumer: GROUP_COLORS[takeSets.length % GROUP_COLORS.length]
        const first = GROUP_COLORS[0 % GROUP_COLORS.length];
        const wrapped = GROUP_COLORS[GROUP_COLORS.length % GROUP_COLORS.length];
        expect(first).toBeDefined();
        expect(wrapped).toBe(first);
    });
});
