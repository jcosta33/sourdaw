import { describe, expect, it } from 'vitest';

import { isCaptureWindowFailure } from '../desktopCrumbsSamplerDrive.ts';
import {
    crumbsSamplerFailure,
    freshCrumbsSamplerObservations,
    type CrumbsTrial,
} from '../desktopCrumbsSamplerEvidence.ts';
import { measureCrumbsWindow } from '../desktopCrumbsSamplerSignal.ts';

function trial(kind: CrumbsTrial['kind']): CrumbsTrial {
    return {
        kind,
        pressFrame: 40000,
        actionFrame: 76864,
        trustedDown: true,
        trustedUp: true,
        nativeRunning: true,
        advancing: true,
        baseline: {
            firstFrame: 0,
            frames: 32768,
            sampleRate: 48000,
            tone431: 0,
            tone619: 0,
            sentinel220: 0.1,
            minimumSentinel220: 0.1,
        },
        positive: {
            firstFrame: 44096,
            frames: 32768,
            sampleRate: 48000,
            tone431: 0.1,
            tone619: 0,
            sentinel220: 0.1,
            minimumSentinel220: 0.1,
        },
        late: {
            firstFrame: 76864,
            frames: 98304,
            sampleRate: 48000,
            tone431: kind === 'held' ? 0.1 : 0,
            tone619: 0,
            sentinel220: 0.1,
            minimumSentinel220: 0.1,
        },
    };
}

function complete() {
    const o = freshCrumbsSamplerObservations();
    const snapshot = {
        trackId: 'track',
        deviceId: 'device',
        filePath: 'crumbs-drops/c15-isolated-crumbs-431hz.wav',
        fileName: 'c15-isolated-crumbs-431hz.wav',
        frameCount: 352800,
        sampleRate: 44100,
        channels: 1,
        sampleId: 1,
        mode: 'drum',
        cutoff: 19990,
        trackDigest: 'a'.repeat(64),
        deviceDigest: 'b'.repeat(64),
    };
    Object.assign(o, {
        input: 'BlackHole 2ch',
        output: 'BlackHole 2ch',
        trackId: 'track',
        deviceId: 'device',
        trustedDrop: true,
        control619: {
            firstFrame: 0,
            frames: 32768,
            sampleRate: 48000,
            tone431: 0,
            tone619: 0.1,
            sentinel220: 0,
            minimumSentinel220: 0,
        },
        seekBeats: { fresh: 22, reopened: 22 },
        sampleSha256: '230e1149ce88caad99849d11ddcfb6b823e12ca8deb8e3029b97984e91205477',
        savedClean: true,
        savedSnapshot: snapshot,
        reopenedSnapshot: structuredClone(snapshot),
        savedHeads: ['d'.repeat(64)],
        reopenedHeads: ['e'.repeat(64)],
        savedHeadsPresent: true,
        reopenStartup: { state: 'original-track', trackIds: ['track'], detail: '', binary: 'matched' },
        reopenedTrackId: 'track',
        reopenedDeviceId: 'device',
        quits: [
            { code: 0, signal: null, forced: false },
            { code: 0, signal: null, forced: false },
        ],
        trials: { fresh: [trial('held'), trial('release')], reopened: [trial('held'), trial('release')] },
    });
    return o;
}

describe('Crumbs sampler evidence admission', () => {
    it('classifies only known capture-window failures', () => {
        expect(isCaptureWindowFailure(new Error('jsHandle.evaluate: Error: capture-clock-stale\nstack'))).toBe(true);
        expect(isCaptureWindowFailure(new Error('capture-window-invalid'))).toBe(true);
        expect(isCaptureWindowFailure(new Error('unexpected decoder failure'))).toBe(false);
    });
    it('separates 431 Hz sample, 220 Hz sentinel and 619 Hz control', () => {
        const values = Array.from(
            { length: 32768 },
            (_, i) => 0.1 * Math.sin((2 * Math.PI * 431 * i) / 48000) + 0.05 * Math.sin((2 * Math.PI * 220 * i) / 48000)
        );
        const window = measureCrumbsWindow({ firstFrame: 128, endFrame: 32896, sampleRate: 48000, values });
        expect(window.tone431).toBeGreaterThan(0.09);
        expect(window.minimumSentinel220).toBeGreaterThan(0.04);
        expect(window.tone619).toBeLessThan(0.001);
    });
    it('accepts complete matched evidence', () => expect(crumbsSamplerFailure(complete())).toBeNull());
    it('rejects missing and altered binary evidence', () => {
        expect(crumbsSamplerFailure(freshCrumbsSamplerObservations())).toBe('crumbs-observations-incomplete');
        const o = complete();
        o.reopenedSnapshot!.cutoff = 100;
        expect(crumbsSamplerFailure(o)).toBe('crumbs-observations-incomplete');
        const crashed = complete();
        crashed.quits[1] = { code: null, signal: 'SIGSEGV', forced: false };
        expect(crumbsSamplerFailure(crashed)).toBe('crumbs-observations-incomplete');
    });
    it.each(['savedHeads', 'reopenedHeads'] as const)('rejects missing or malformed %s', (field) => {
        for (const heads of [[], ['not-a-hash'], ['a'.repeat(63)]]) {
            const observation = complete();
            observation[field] = heads;
            expect(crumbsSamplerFailure(observation)).toBe('crumbs-observations-incomplete');
        }
    });
    it('rejects a matching snapshot without saved binary ancestry', () => {
        const observation = complete();
        observation.savedHeadsPresent = false;
        expect(crumbsSamplerFailure(observation)).toBe('crumbs-observations-incomplete');
    });
    it('rejects binary presence without the original track in the reopened UI', () => {
        const observation = complete();
        observation.reopenStartup!.state = 'launch-screen';
        expect(crumbsSamplerFailure(observation)).toBe('crumbs-observations-incomplete');
        observation.reopenStartup!.state = 'original-track';
        observation.reopenStartup!.trackIds = ['other'];
        expect(crumbsSamplerFailure(observation)).toBe('crumbs-observations-incomplete');
    });
    it('rejects lost sentinel and unreleased sample', () => {
        const lost = complete();
        lost.trials.fresh[1]!.late.minimumSentinel220 = 0;
        expect(crumbsSamplerFailure(lost)).toBe('crumbs-audio-invalid');
        const stuck = complete();
        stuck.trials.reopened[1]!.late.tone431 = 0.1;
        expect(crumbsSamplerFailure(stuck)).toBe('crumbs-audio-invalid');
    });
    it('rejects bleed and non-integral capture clocks', () => {
        const bleed = complete();
        bleed.trials.fresh[0]!.baseline.tone431 = 0.1;
        expect(crumbsSamplerFailure(bleed)).toBe('crumbs-audio-invalid');
        const badClock = complete();
        badClock.trials.reopened[1]!.actionFrame = NaN;
        expect(crumbsSamplerFailure(badClock)).toBe('crumbs-audio-invalid');
        const controlBleed = complete();
        controlBleed.trials.fresh[0]!.baseline.tone619 = 0.1;
        expect(crumbsSamplerFailure(controlBleed)).toBe('crumbs-audio-invalid');
    });
    it('classifies capture failure as unavailable', () => {
        const o = freshCrumbsSamplerObservations();
        o.unavailable = 'capture-named-input-unavailable';
        expect(crumbsSamplerFailure(o)).toBe('capture-unavailable');
    });
});
