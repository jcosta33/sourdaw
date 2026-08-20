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

    it('marks its newly constructed Dutch Oven with the corrected damping semantics', () => {
        const dutchOven = demoSource.match(/type:\s*['"]dutch-oven['"][\s\S]*?parameterValues:\s*\{([\s\S]*?)\n\s*\}/);
        expect(dutchOven?.[1]).toContain('fdn_damping_version: 2');
    });

    it('checks every constructed device against release admission', () => {
        expect(demoSource).toContain('assertReleaseAdmittedDevices(tracks);');
    });

    /**
     * Intro audibility.
     *
     * Reported by the owner: "the automation is setting pretty much all tracks
     * to be mute until like the 11th bar, so the track is completely mute for a
     * long time."
     *
     * Measured cause: 18 of 23 gain lanes open at exactly 0 and hold flat zero
     * through a staggered entry staircase (Grain 22, Halo 26, Veil 34, Sweep 40,
     * Rising 48, Toaster bus 62, pads 70). Levain High does not reach `hero`
     * until beat 44 — bar 11 at this project's 76 bpm, exactly where the owner
     * said it opens up. So the only thing sounding before that was the Levain
     * bed at 0.1, about −20 dB.
     *
     * The staircase is the composition and is deliberately untouched. What these
     * guard is that it starts from an audible floor. Both read the numeric
     * literal rather than the surrounding text, so they fail on a value change
     * and not on a reformat.
     *
     * Limitation, stated rather than implied: this file asserts against source
     * because `demo5_NebulaDrift()` wires real AudioEngine use-cases and worklet
     * modules that need a live AudioContext, so it cannot run under jsdom (see
     * the header). A signal-level assertion belongs to the render-parity
     * instrumentation phase, not here.
     */
    const AUDIBLE_GAIN_FLOOR = 0.15;

    it('opens on an audible Levain bed rather than a −20 dB whisper', () => {
        const match = demoSource.match(/const levBed = ([\d.]+);/);
        expect(match).not.toBeNull();

        const levBed = Number(match![1]);
        expect(levBed).toBeGreaterThanOrEqual(AUDIBLE_GAIN_FLOOR);
    });

    it('has Dark Mist already sounding at beat 0, since it carries the intro alone', () => {
        // Dark Mist is the first texture to enter; every other texture lane is
        // still holding flat zero. If it starts at silence the opening bars have
        // only the Levain bed in them.
        const laneStart = demoSource.indexOf("'Mist level'");
        expect(laneStart).toBeGreaterThan(0);

        const firstPoint = demoSource.slice(laneStart).match(/\{ beat: 0, value: ([\d.]+),/);
        expect(firstPoint).not.toBeNull();
        expect(Number(firstPoint![1])).toBeGreaterThan(0);
    });

    it('commits project truth before yielding for device readiness', () => {
        const projectWriteOffset = demoSource.lastIndexOf('projectStore.set({');
        const readinessOffset = demoSource.indexOf('await waitForDevices();');

        expect(projectWriteOffset).toBeGreaterThan(0);
        expect(readinessOffset).toBeGreaterThan(0);
        expect(projectWriteOffset).toBeLessThan(readinessOffset);
    });
});
