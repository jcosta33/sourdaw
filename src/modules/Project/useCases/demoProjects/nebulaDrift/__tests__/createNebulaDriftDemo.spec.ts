import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { demo5_NebulaDrift } from '../createNebulaDriftDemo';

/**
 * The demo is engine-bound: demo5_NebulaDrift() wires real AudioEngine use-cases
 * (addDeviceToStrip / ensureTrackStrip / waitForDevices) and worklet `?worker&url`
 * modules that need a live AudioContext, so it cannot be invoked end-to-end under
 * jsdom. The regression below therefore guards the one piece of baked data the fix
 * corrects — the Grain Haze freeze state — by reading the demo source module.
 *
 * The bug: the demo set
 *   tGrainHaze.freezeState = { status: 'frozen', frozenBufferId: 'demo-grain-haze-frozen' }
 * but never wrote that buffer id to audioBufferCache. The freeze-aware export and
 * scheduling paths (renderOffline.ts, offlineRender/scheduleTrackClips.ts,
 * scheduling/scheduleMidiNotes.ts) key off `freezeState.status === 'frozen' &&
 * freezeState.frozenBufferId`: they skip the track's clip scheduling and read the
 * absent buffer, so every export of this demo emitted a "missing audio buffer"
 * warning and dropped Grain Haze to silence. Shipping the track unfrozen makes the
 * export schedule its live clips instead.
 */
const demoSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'createNebulaDriftDemo.ts'),
    'utf8'
);

describe('createNebulaDriftDemo', () => {
    it('exports demo5_NebulaDrift', () => {
        expect(typeof demo5_NebulaDrift).toBe('function');
    });

    it('does not reference the phantom frozen buffer id that was never cached', () => {
        expect(demoSource).not.toContain('demo-grain-haze-frozen');
    });

    it('does not bake a frozen freezeState (no producer writes a frozen buffer for the demo)', () => {
        // No track in the demo may declare a frozen freezeState, because the demo
        // never renders/caches a frozen buffer for one to point at.
        expect(demoSource).not.toMatch(/freezeState\s*=\s*\{[^}]*status:\s*['"]frozen['"]/);
    });

    it('does not truncate demo device/track ids to 8 hex chars (collision risk at scale)', () => {
        // crypto.randomUUID().slice(0, 8) yields an 8-hex-char id that collides at
        // scale; demo ids must use the full UUID.
        expect(demoSource).not.toContain('randomUUID().slice(0, 8)');
    });

    it('commits project truth before yielding for device readiness', () => {
        const projectWriteOffset = demoSource.lastIndexOf('projectStore.set({');
        const readinessOffset = demoSource.indexOf('await waitForDevices();');

        expect(projectWriteOffset).toBeGreaterThan(0);
        expect(readinessOffset).toBeGreaterThan(0);
        expect(projectWriteOffset).toBeLessThan(readinessOffset);
    });
});
