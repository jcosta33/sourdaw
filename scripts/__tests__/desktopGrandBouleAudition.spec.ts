// @vitest-environment node
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
    auditionFailure,
    freshAuditionObservations,
    measureSignalWindow,
    validWindow,
    type AuditionObservations,
    type SignalWindow,
} from '../desktopGrandBouleAuditionEvidence.ts';
import { RECEIVE_WORKLET } from '../desktopGrandBouleCapture.ts';

function signal(firstFrame = 0, frames = 32768, preview = 0.01, sentinel = 0.02): SignalWindow {
    return measureSignalWindow({
        firstFrame,
        endFrame: firstFrame + frames,
        sampleRate: 48000,
        values: Array.from(
            { length: frames },
            (_, i) =>
                sentinel * Math.sin((2 * Math.PI * 220 * i) / 48000) +
                preview * Math.sin((2 * Math.PI * 261.625565 * i) / 48000)
        ),
    });
}
function complete(): AuditionObservations {
    const o = freshAuditionObservations();
    return {
        ...o,
        input: 'BlackHole 2ch',
        output: 'BlackHole 2ch',
        trackId: 'track',
        deviceId: 'piano',
        appQuit: true,
        quiet: signal(0, 32768, 0, 0),
        trials: (['held', 'release', 'close'] as const).map((kind) => ({
            kind,
            pressFrame: 32768,
            scheduled: signal(0, 32768, 0),
            positive: signal(36864),
            late: signal(69632, 98304, kind === 'held' ? 0.008 : 0.0001),
            actionFrame: 70144,
            nativeCarrier: true,
            advancing: true,
        })),
    };
}
describe('Grand Boule packaged output evidence', () => {
    it('discriminates matched held decay, ordinary release and close while sentinel continues', () => {
        expect(auditionFailure(complete())).toBeNull();
    });
    it.each(['release', 'close'] as const)('rejects a %s that remains held', (kind) => {
        const o = complete();
        o.trials.find((t) => t.kind === kind)!.late = signal(69632, 98304, 0.008);
        expect(auditionFailure(o)).toBe('preview-did-not-release');
    });
    it('rejects sentinel loss and a short drop inside an otherwise positive post-action span', () => {
        const o = complete();
        const values = Array.from({ length: 98304 }, (_, i) =>
            i >= 8192 && i < 16384 ? 0 : 0.02 * Math.sin((2 * Math.PI * 220 * i) / 48000)
        );
        o.trials[2]!.late = measureSignalWindow({ firstFrame: 69632, endFrame: 167936, sampleRate: 48000, values });
        expect(o.trials[2]!.late.sentinel).toBeGreaterThan(0.01);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
    });
    it('rejects a decayed held control and missing positive preview', () => {
        const o = complete();
        o.trials[0]!.late = signal(69632, 98304, 0);
        expect(auditionFailure(o)).toBe('held-control-decayed');
        o.trials[0]!.positive = signal(36864, 32768, 0);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
    });
    it('rejects noise, absent frames, stale windows, rate drift and missing carrier', () => {
        const o = complete();
        o.quiet!.rms = 0.01;
        expect(auditionFailure(o)).toBe('quiet-baseline-invalid');
        o.quiet = signal(0, 32768, 0, 0);
        o.trials[0]!.late.firstFrame++;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        o.trials[0]!.late = signal(69632, 98304, 0.008);
        o.trials[0]!.nativeCarrier = false;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        o.trials[0]!.nativeCarrier = true;
        o.trials[0]!.late.sampleRate = 44100;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        expect(validWindow({ ...signal(), frames: 0 })).toBe(false);
        expect(validWindow({ ...signal(), rms: NaN })).toBe(false);
    });
    it('rejects mismatched note age and preview content already present before pressing', () => {
        const o = complete();
        o.trials[1]!.pressFrame -= 128;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        o.trials[1]!.pressFrame += 128;
        o.trials[1]!.scheduled = signal(0);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
        o.trials[1]!.scheduled = signal(0, 32768, 0, 0);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
        o.trials[1]!.scheduled = signal(128, 32768, 0);
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
    });
    it('retains unavailable capture as no proof', () => {
        const o = complete();
        o.unavailable = 'permission-or-capture-unavailable';
        expect(auditionFailure(o)).toBe('capture-unavailable');
    });
});

type Processor = {
    port: { onmessage: ({ data }: { data: { start: number; count: number } }) => void };
    process: (input: number[][][]) => boolean;
};
function worklet() {
    const messages: { error?: string; firstFrame?: number; endFrame?: number; values?: Float32Array }[] = [];
    let processor: Processor | undefined;
    const scope = {
        currentFrame: 0,
        sampleRate: 48000,
        AudioWorkletProcessor: class {
            port = { postMessage: (data: (typeof messages)[number]) => messages.push(data) };
        },
        registerProcessor: (_name: string, Constructor: new () => Processor) => {
            processor = new Constructor();
        },
    };
    runInNewContext(RECEIVE_WORKLET, scope);
    if (!processor) {
        throw new Error('processor absent');
    }
    return {
        processor,
        scope,
        messages,
        tick: (channel = true) => {
            processor!.process(channel ? [[Array(128).fill(0.1)]] : []);
            scope.currentFrame += 128;
        },
    };
}
describe('actual bounded receive worklet', () => {
    it('returns exact historical contiguous frames without an audible output', () => {
        const w = worklet();
        w.tick();
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        for (let i = 0; i < 256; i++) {
            w.tick();
        }
        expect(w.messages[0]).toMatchObject({ firstFrame: 128, endFrame: 32896 });
        expect(w.messages[0]!.values).toHaveLength(32768);
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        w.tick();
        expect(w.messages[1]).toMatchObject({ firstFrame: 128, endFrame: 32896 });
    });
    it.each(['gap', 'empty'] as const)('fails closed on %s input', (kind) => {
        const w = worklet();
        w.tick();
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        if (kind === 'gap') {
            w.scope.currentFrame += 128;
        }
        w.tick(kind !== 'empty');
        expect(w.messages).toEqual([{ error: 'capture-continuity-lost' }]);
    });
    it('waits for first real input and rejects nonexistent pre-start history', () => {
        const w = worklet();
        w.processor.port.onmessage({ data: { start: 0, count: 32768 } });
        w.tick(false);
        w.scope.currentFrame = 4096;
        for (let i = 0; i < 256; i++) {
            w.tick();
        }
        expect(w.messages[0]).toMatchObject({ firstFrame: 4096, endFrame: 36864 });
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        w.tick();
        expect(w.messages[1]).toEqual({ error: 'capture-window-stale' });
    });
    it('refuses frames aged out of its bounded ring', () => {
        const w = worklet();
        for (let i = 0; i < 2100; i++) {
            w.tick();
        }
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        w.tick();
        expect(w.messages).toEqual([{ error: 'capture-window-stale' }]);
    });
});
