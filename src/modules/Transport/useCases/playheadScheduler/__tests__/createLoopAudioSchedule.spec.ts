import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SourceWithFade } from '../../../models/SourceWithFade';
import { defaultTransportState } from '../../../models/TransportState';
import { createLoopAudioSchedule } from '../createLoopAudioSchedule';

const fixture = vi.hoisted(() => ({
    tracks: [] as {
        id: string;
        kind: string;
        muted: boolean;
        sends: never[];
        freezeState: { status: string };
        clips: { id: string; type: string; startBeat: number; endBeat: number; audioBufferId: string }[];
    }[],
    time: 10,
    current: true,
    fail: false,
    advanceOnNextEmit: 0,
    advancePerEmit: 0,
    compensationSeconds: 0,
}));
const buffer = vi.hoisted(() => ({ duration: 16 }));
const emitted = vi.hoisted(() => [] as SourceWithFade[]);
const windows = vi.hoisted(() => [] as { from: number; to: number; anchor: number }[]);
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return { tracks: fixture.tracks };
        },
    },
    gainEnvelopeStore: { value: null },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: (_id: string, clips: unknown[]) => clips,
}));
vi.mock('#/modules/MIDI/stores', () => ({ midiStore: { value: {} } }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: () => buffer,
    getCompensationDelay: () => fixture.compensationSeconds,
}));
vi.mock('../../scheduling/scheduleFrozenTrack', () => ({ scheduleFrozenTrack: vi.fn() }));
vi.mock('../../scheduling/scheduleAudioClips', () => ({
    scheduleAudioClips: (
        from: number,
        to: number,
        _position: number,
        audio: Set<string>,
        _frozen: Set<string>,
        active: SourceWithFade[],
        transport: typeof defaultTransportState,
        anchor: number
    ) => {
        windows.push({ from, to, anchor });
        if (audio.has('source')) return;
        const source = {
            scheduledTrackId: 'track',
            scheduledAudioKey: 'source',
            scheduledStartTime: anchor + fixture.compensationSeconds,
            scheduledEndTime: anchor + 10,
            compensationSeconds: fixture.compensationSeconds,
            start: vi.fn(),
            stop: vi.fn(),
            fadeGainNode: {
                gain: {
                    cancelAndHoldAtTime: vi.fn(),
                    cancelScheduledValues: vi.fn(),
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn(),
                    value: 1,
                },
            },
        } as unknown as SourceWithFade;
        active.push(source);
        emitted.push(source);
        audio.add('source');
        fixture.time += fixture.advanceOnNextEmit + fixture.advancePerEmit;
        fixture.advanceOnNextEmit = 0;
        if (fixture.fail) throw new Error('Source emission failed');
    },
}));

function make(clock: () => number = () => 0) {
    return createLoopAudioSchedule({
        context: {
            get currentTime() {
                return fixture.time;
            },
            sampleRate: 48000,
        } as BaseAudioContext,
        isCurrent: () => fixture.current,
        monotonicTime: clock,
    });
}
function input(loopEnd = 0.25, time = 10, position = 0) {
    return {
        transport: { ...defaultTransportState, tempo: 120, isPlaying: true, isLooping: true, loopStart: 0, loopEnd },
        changes: [],
        position,
        audioTime: time,
    };
}
beforeEach(() => {
    fixture.time = 10;
    fixture.current = true;
    fixture.fail = false;
    fixture.advanceOnNextEmit = 0;
    fixture.advancePerEmit = 0;
    fixture.compensationSeconds = 0;
    emitted.length = 0;
    windows.length = 0;
    fixture.tracks = [
        {
            id: 'track',
            kind: 'audio',
            muted: false,
            sends: [],
            freezeState: { status: 'unfrozen' },
            clips: [{ id: 'clip', type: 'audio', startBeat: 0, endBeat: 4, audioBufferId: 'buffer' }],
        },
    ];
});
describe('loop buffer work and lifetime ownership', () => {
    it('publishes only completed coverage and keeps an admitted successor on late promotion', () => {
        const owner = make();
        expect(owner.refill(input()).through).toBe(10.35);
        const successor = owner.poolAt(10.125, true)?.sources[0];
        fixture.time = 10.2;
        owner.refill(input(0.25, 10.2, 0.15));
        expect(owner.poolAt(10.2)?.sources[0]).toBe(successor);
        expect(successor?.stop).toHaveBeenCalledExactlyOnceWith(10.25);
    });
    it('bounds tiny-loop work with an unmoving monotonic clock and reports the shortfall', () => {
        const owner = make();
        const coverage = owner.refill(input(2e-10));
        expect(coverage.windows).toBe(64);
        expect(coverage.shortfall).toBe('pass-budget');
        expect(coverage.through).toBeLessThan(10.000001);
        expect(emitted).toHaveLength(64);
    });
    it('stops at the measured time allowance between complete units', () => {
        const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(40);
        const owner = make(clock);
        expect(owner.refill(input())).toMatchObject({ through: 10.125, windows: 1, shortfall: 'time-budget' });
        expect(emitted).toHaveLength(1);
    });
    it('measures the completed350ms horizon after preparation advances the actual audio clock', () => {
        fixture.advanceOnNextEmit = 0.02;
        const coverage = make().refill(input());
        expect(coverage.shortfall).toBeNull();
        expect(coverage.through - fixture.time).toBeCloseTo(0.35, 12);
        expect(coverage.target).toBeCloseTo(10.37, 12);
        expect(coverage.completionAudioTime).toBe(10.02);
        expect(coverage.through).toBeGreaterThanOrEqual(coverage.completionAudioTime + 0.35);
    });
    it('reports a finite shortfall when the audio clock keeps outrunning tiny-loop preparation', () => {
        fixture.advancePerEmit = 0.01;
        const coverage = make().refill(input(2e-10));
        expect(coverage.windows).toBe(64);
        expect(coverage.shortfall).toBe('pass-budget');
        expect(coverage.through).toBeLessThan(coverage.completionAudioTime + 0.35);
        expect(emitted).toHaveLength(64);
    });
    it('skips an empty programme without walking its billions of empty passes', () => {
        fixture.tracks = [];
        expect(make().refill(input(2e-10))).toMatchObject({ through: 10.35, windows: 0, shortfall: null });
        expect(emitted).toEqual([]);
    });
    it('cancels all future sources before their starts, including a start less than5ms away', () => {
        const owner = make();
        owner.refill(input());
        const future = owner.poolAt(10.125, true)?.sources[0];
        fixture.time = 10.124;
        owner.reset();
        expect(future?.stop).toHaveBeenLastCalledWith(10.124);
    });
    it('keeps earlier envelope events until the future seam ramp', () => {
        make().refill(input());
        const gain = emitted[0]?.fadeGainNode?.gain;
        expect(gain?.cancelAndHoldAtTime).toHaveBeenCalledExactlyOnceWith(10.12);
        expect(gain?.cancelScheduledValues).not.toHaveBeenCalled();
        expect(gain?.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(0, 10.125);
    });
    it('retires a cancelled generation and emits nothing on its late continuation', () => {
        const owner = make();
        owner.refill(input());
        const count = emitted.length;
        fixture.current = false;
        expect(owner.refill(input()).shortfall).toBe('retired');
        expect(emitted).toHaveLength(count);
        expect(owner.active).toBe(false);
    });
    it('cancels a failed partial suffix without retiring earlier completed pass sources', () => {
        const owner = make();
        owner.refill(input());
        const completed = [...emitted];
        const stops = completed.map((source) => vi.mocked(source.stop).mock.calls.map((call) => [...call]));
        fixture.fail = true;
        expect(() => owner.refill(input(0.25, 10.1, 0.2))).toThrow('Source emission failed');
        expect(owner.coverage.through).toBe(10.375);
        expect(owner.poolAt(10.375, true)?.sources).toEqual([]);
        expect(emitted.at(-1)?.stop).toHaveBeenLastCalledWith(10);
        for (const [index, source] of completed.entries())
            expect(vi.mocked(source.stop).mock.calls).toEqual(stops[index]);
    });
    it('reconciles only the retained admitted window rather than widening it to the whole pass', () => {
        const owner = make();
        owner.refill(input(4));
        fixture.tracks[0]!.clips[0]!.audioBufferId = 'replacement';
        fixture.time = 10.1;
        owner.refill(input(4, 10.1, 0.2));
        expect(windows[1]?.anchor).toBe(10);
        expect(windows[1]?.from).toBe(0);
        expect(windows[1]?.to).toBeCloseTo(0.7, 12);
    });
    it('continues pending retained reconciliation after a work shortfall without revisiting its completed prefix', () => {
        fixture.compensationSeconds = 0.5;
        let bounded = false;
        let clockReads = 0;
        const owner = make(() => (!bounded || ++clockReads <= 2 ? 0 : 40));
        owner.refill(input());
        fixture.time = 10.2;
        owner.refill(input(0.25, 10.2, 0.15));
        const oldSecondPass = owner.poolAt(10.125, true)!.sources[0]!;
        fixture.tracks[0]!.clips[0]!.audioBufferId = 'replacement';
        const firstRepair = windows.length;
        bounded = true;
        expect(owner.refill(input(0.25, 10.2, 0.15))).toMatchObject({
            windows: 1,
            through: 10.2,
            shortfall: 'time-budget',
        });
        expect(windows[firstRepair]?.anchor).toBe(10);
        // Unreconciled future material is already invalidated, even when its
        // replacement cannot be admitted within this turn's work allowance.
        expect(oldSecondPass.stop).toHaveBeenLastCalledWith(10.2);
        const nextRepair = windows.length;
        bounded = false;
        expect(owner.refill(input(0.25, 10.2, 0.15)).shortfall).toBeNull();
        expect(windows[nextRepair]?.anchor).toBe(10.125);
        expect(windows.slice(nextRepair).some((window) => window.anchor === 10)).toBe(false);
    });
});
