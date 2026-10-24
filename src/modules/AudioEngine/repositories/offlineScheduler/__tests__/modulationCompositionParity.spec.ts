import { describe, expect, it, vi } from 'vitest';

import { secondsBetweenBeats } from '#/modules/Transport/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { type OfflineDeviceNode } from '../../deviceNodeFactory';
import { type OfflineAutomationBinding, type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';
import { type OfflineModulatorPlan } from '../automationScheduling';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

function param() {
    const writes: { value: number; time: number }[] = [];
    return {
        value: 0,
        writes,
        setValueAtTime: vi.fn((value: number, time: number) => writes.push({ value, time })),
        linearRampToValueAtTime: vi.fn((value: number, time: number) => writes.push({ value, time })),
    };
}

function lane(value: number, id = 'lane'): AutomationLane {
    return {
        id,
        trackId: 'track',
        parameterId: 'device:param',
        parameterName: 'parameter',
        points: [{ beat: 0, value, curve: 'step', tension: 0 }],
        enabled: true,
        minValue: -100,
        maxValue: 100,
    };
}

function plan(delta: number | ((beat: number) => number)): OfflineModulatorPlan {
    return {
        targetTrackId: 'track',
        deviceId: 'device',
        deviceType: 'fixture',
        parameterId: 'param',
        baseValue: 0,
        paramMin: -100,
        paramMax: 100,
        deltaAtBeat: typeof delta === 'number' ? () => delta : delta,
    };
}

function run(
    binding: OfflineAutomationBinding,
    plans: OfflineModulatorPlan[],
    lanes: AutomationLane[] = [],
    quantise = (value: number) => value,
    options: Partial<Parameters<typeof scheduleTrackAutomationFixture>[0]> = {}
) {
    scheduleTrackAutomationFixture({
        trackId: 'track',
        lanes,
        trackGainNode: { gain: param() as unknown as AudioParam },
        trackPanNode: { pan: param() as unknown as AudioParam },
        deviceEntries: [
            { deviceId: 'device', deviceType: 'fixture', strategy: { resolveOfflineAutomation: () => binding } },
        ],
        deviceParameterLaw: {
            acceptsAutomation: () => true,
            clampValue: ({ value }) => value,
            quantiseValue: ({ value }) => quantise(value),
        },
        modulatorPlans: plans,
        durationSeconds: 0.03,
        changes: [],
        slewTickSeconds: 0.01,
        sampleRate: 1000,
        ...options,
    });
}

function audioBinding(target = param()): { target: ReturnType<typeof param>; binding: OfflineAutomationBinding } {
    return {
        target,
        binding: {
            kind: 'audioParam',
            targets: [{ audioParam: target as unknown as AudioParam, scale: 1, offset: 0 }],
        },
    };
}

describe('offline modulation composes device units and actual terminal writes', () => {
    it.each(['builtin-gain', 'builtin-deesser'])('converts %s once and schedules each real tap once', (deviceType) => {
        const first = param();
        const second = param();
        const node: OfflineDeviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: first } as unknown as AudioNode],
            namedNodes: {
                gain: { gain: first } as unknown as AudioNode,
                wet: { gain: first } as unknown as AudioNode,
                cancel: { gain: second } as unknown as AudioNode,
            },
        };
        const parameterId = deviceType === 'builtin-gain' ? 'gain-level' : 'deess-range';
        const binding = new WebAudioDeviceStrategy(node, deviceType).resolveOfflineAutomation(parameterId);
        expect(binding?.kind).toBe('audioParam');
        const baseLane = { ...lane(-6), parameterId: `device:${parameterId}` };
        const mapping = { ...plan(1), parameterId, deviceType };
        run(binding!, [mapping], [baseLane]);
        const expected = deviceType === 'builtin-gain' ? dbToGain(-5) : 1 - dbToGain(-5);
        expect(first.writes[0]?.value).toBeCloseTo(expected, 10);
        expect(first.writes).toHaveLength(1);
        if (deviceType === 'builtin-deesser') {
            expect(second.writes).toHaveLength(1);
            expect(second.writes[0]?.value).toBeCloseTo(-expected, 10);
        }
    });

    it('advances the shared continuous slot through mappings in order', () => {
        const { target, binding } = audioBinding();
        run(binding, [plan(10), plan(30)]);
        expect(target.writes).toHaveLength(3);
        for (const [index, value] of [18, 20.88, 21.9168].entries()) {
            expect(target.writes[index]?.value).toBeCloseTo(value, 10);
        }
    });

    it('holds the last actual terminal while sub-epsilon updates advance the slot', () => {
        const { target, binding } = audioBinding();
        run(binding, [plan((beat) => (beat === 0 ? 1 : 1.00001))]);
        expect(target.writes).toEqual([{ time: 0, value: 1 }]);
    });

    it('keeps an automation write when a rounded modulation update skips', () => {
        const { target, binding } = audioBinding();
        run(binding, [plan((beat) => (beat === 0 ? 1 : 1.04))], [lane(5)], Math.round);
        expect(target.writes).toEqual([{ time: 0, value: 6 }]);
    });

    it('forces modulation terminal delivery with competing active automation lanes', () => {
        const { target, binding } = audioBinding();
        run(binding, [plan(1)], [lane(5, 'first'), lane(5, 'last')], Math.round);
        expect(target.writes.map(({ value }) => value)).toEqual([6, 6, 6]);
    });

    it.each([false, true])('keeps a material curve over a later held duplicate, linked=%s', (linked) => {
        const { target, binding } = audioBinding();
        const material = lane(5, 'material');
        material.points[0]!.curve = 'linear';
        material.points.push({ beat: 0.04, value: 7, curve: 'linear', tension: 0 });
        const source = { ...material, id: 'source', trackId: 'other' };
        const follower = { ...lane(0, 'follower'), linkedLaneId: 'source' };
        run(binding, [plan(1)], linked ? [source, follower, lane(20, 'held')] : [material, lane(20, 'held')]);
        expect(target.writes.map(({ time }) => time)).toEqual([0, 0.01, 0.02]);
        for (const [index, value] of [6, 6.16, 6.512].entries()) {
            expect(target.writes[index]?.value).toBeCloseTo(value, 10);
        }
    });

    it('counts a suppressed held duplicate when forcing competing modulation delivery', () => {
        const { target, binding } = audioBinding();
        const material = lane(5, 'material');
        material.points.push({ beat: 0.04, value: 5, curve: 'step', tension: 0 });
        run(binding, [plan(1)], [material, lane(20, 'held')]);
        expect(target.writes.map(({ value }) => value)).toEqual([6, 6, 6]);
    });

    it.each(['lone', 'equal-zero-span', 'disabled-material', 'clip-held'] as const)(
        'preserves held-lane admission for %s',
        (scope) => {
            const { target, binding } = audioBinding();
            const material = lane(5, 'material');
            material.points.push({ beat: 0.04, value: 7, curve: 'linear', tension: 0 });
            const held = lane(20, 'held');
            let lanes: AutomationLane[] = [held];
            if (scope === 'equal-zero-span') {
                lanes = [lane(5, 'earlier'), held];
            }
            if (scope === 'disabled-material') {
                lanes = [{ ...material, enabled: false }, held];
            }
            if (scope === 'clip-held') {
                lanes = [material, { ...held, clipId: 'clip' }];
            }
            run(binding, [plan(1)], lanes, undefined, {
                clipBoundsById: new Map([['clip', { startBeat: 0, endBeat: 0.06 }]]),
            });
            expect(target.writes.map(({ value }) => value)).toEqual(
                scope === 'equal-zero-span' || scope === 'clip-held' ? [21, 21, 21] : [21]
            );
        }
    );

    it('retains continuous state through quantised skips across ordered mappings', () => {
        const { target, binding } = audioBinding();
        run(binding, [plan(5), plan(6)], [], Math.round);
        expect(target.writes.map(({ value }) => value)).toEqual([5, 6, 6]);
    });

    for (const family of ['audioParam', 'segments', 'curveWrite'] as const) {
        for (const competing of [false, true]) {
            it(`${family} retains automation's actual 5 after modulation's skipped 6, competing=${competing}`, () => {
                const target = param();
                let segments: readonly OfflineAutomationSegment[] = [];
                const ceiling = { gain: { value: 0 } } as GainNode;
                const clipper = { curve: null } as WaveShaperNode;
                const frameWrites: { value: number; time: number }[] = [];
                let binding: OfflineAutomationBinding;
                if (family === 'audioParam') {
                    binding = audioBinding(target).binding;
                } else if (family === 'segments') {
                    binding = {
                        kind: 'segments',
                        apply: (stream) => {
                            segments = stream;
                        },
                    };
                } else {
                    binding = { kind: 'curveWrite', targets: { ceiling, clipper } };
                }
                const automated = lane(6);
                automated.points.push({ beat: 0.02, value: 3.5, curve: 'step', tension: 0 });
                const lanes = competing ? [{ ...automated, id: 'earlier' }, automated] : [automated];
                run(binding, [plan((beat) => (beat === 0 ? 0 : 1))], lanes, Math.round, {
                    durationSeconds: 0.02,
                    compensationDelaySec: 0.002,
                    scheduleFrame: (time, call) => {
                        call();
                        frameWrites.push({ value: ceiling.gain.value, time: time ?? 0 });
                    },
                });
                const terminal = competing ? 6 : 5;
                if (family === 'audioParam') {
                    expect(target.writes).toEqual([
                        { value: 6, time: 0 },
                        { value: 6, time: 0.002 },
                        { value: terminal, time: 0.012 },
                    ]);
                } else if (family === 'segments') {
                    expect(segments).toEqual([
                        { startFrame: 2, endFrame: 12, startValue: 6, endValue: 6 },
                        { startFrame: 12, endFrame: 20, startValue: terminal, endValue: terminal },
                    ]);
                } else {
                    expect(frameWrites).toEqual([
                        { value: dbToGain(6), time: 0.002 },
                        { value: dbToGain(terminal), time: 0.012 },
                    ]);
                    expect(clipper.curve).not.toBeNull();
                }
            });
        }
    }

    it.each([false, true])(
        'preserves linked device values and clip ownership before/inside/after, reversed=%s',
        (reversed) => {
            const { target, binding } = audioBinding();
            const source = { ...lane(3, 'source'), trackId: 'other' };
            const linked = { ...lane(0, 'linked'), linkedLaneId: 'source', linkScale: 2, points: [] };
            const clip = { ...lane(8, 'clip'), clipId: 'clip' };
            const ordered = reversed ? [clip, linked] : [linked, clip];
            run(binding, [plan(1)], [source, ...ordered], undefined, {
                durationSeconds: 0.04,
                clipBoundsById: new Map([['clip', { startBeat: 0.02, endBeat: 0.04 }]]),
            });
            expect(target.writes.map(({ time }) => time)).toEqual([0, 0.01, 0.02, 0.03]);
            for (const [index, value] of [7, 7.8, 8.28, 7.768].entries()) {
                expect(target.writes[index]?.value).toBeCloseTo(value, 10);
            }
        }
    );

    for (const family of ['audioParam', 'segments', 'curveWrite'] as const) {
        it.each([false, true])(
            `${family} admits a short clip at both sample-frame boundaries across a tempo step, reversed=%s`,
            (reversed) => {
                const sampleRate = 44_100;
                const compensationDelaySec = 0.005;
                const changes = [
                    { id: 'initial', beat: 0, tempo: 120, curve: 'instant' as const },
                    { id: 'step', beat: 4.04, tempo: 240, curve: 'instant' as const },
                ];
                const projectBeatToSeconds = (beat: number) => secondsBetweenBeats(changes, 0, beat, 120);
                const regionStartSeconds = projectBeatToSeconds(4);
                const stepSeconds = projectBeatToSeconds(4.04);
                expect(Math.round((stepSeconds - regionStartSeconds) * sampleRate)).toBe(882);
                expect(Math.round((projectBeatToSeconds(4.08) - regionStartSeconds) * sampleRate)).toBe(1323);
                const target = param();
                let segments: readonly OfflineAutomationSegment[] = [];
                const ceiling = { gain: { value: 0 } } as GainNode;
                const clipper = { curve: null } as WaveShaperNode;
                const frameWrites: { time: number; value: number }[] = [];
                let binding: OfflineAutomationBinding;
                if (family === 'audioParam') {
                    binding = audioBinding(target).binding;
                } else if (family === 'segments') {
                    binding = {
                        kind: 'segments',
                        apply: (stream) => {
                            segments = stream;
                        },
                    };
                } else {
                    binding = { kind: 'curveWrite', targets: { ceiling, clipper } };
                }

                const source = { ...lane(4, 'source'), trackId: 'other' };
                source.points.push({ beat: 4.08, value: 10, curve: 'linear', tension: 0 });
                source.points[0] = { beat: 4, value: 4, curve: 'linear', tension: 0 };
                const linked = { ...lane(0, 'linked'), linkedLaneId: 'source', points: [] };
                const held = {
                    ...lane(30, 'held'),
                    points: [{ beat: 4, value: 30, curve: 'step' as const, tension: 0 }],
                };
                const clip = { ...lane(12, 'clip'), clipId: 'clip' };
                const ordered = reversed ? [clip, held, linked] : [held, linked, clip];
                run(binding, [plan(0)], [source, ...ordered], undefined, {
                    durationSeconds: 0.05,
                    sampleRate,
                    changes,
                    regionStartBeat: 4,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    projectSecondsToBeat: (seconds) => {
                        const absolute = regionStartSeconds + seconds;
                        if (absolute < stepSeconds) {
                            return 4 + seconds * 2;
                        }
                        return 4.04 + (absolute - stepSeconds) * 4;
                    },
                    clipBoundsById: new Map([['clip', { startBeat: 4.04, endBeat: 4.08 }]]),
                    compensationDelaySec,
                    scheduleFrame: (time, call) => {
                        call();
                        frameWrites.push({ time: time ?? 0, value: 20 * Math.log10(ceiling.gain.value) });
                    },
                });

                let writes: { frame: number; value: number }[];
                if (family === 'audioParam') {
                    writes = target.writes
                        .filter(({ time }) => time > 0)
                        .map(({ time, value }) => ({ frame: Math.round(time * sampleRate), value }));
                } else if (family === 'segments') {
                    writes = segments.map(({ startFrame, startValue }) => ({ frame: startFrame, value: startValue }));
                } else {
                    writes = frameWrites.map(({ time, value }) => ({ frame: Math.round(time * sampleRate), value }));
                    expect(clipper.curve).not.toBeNull();
                }
                const outputFrames = [0, 0.01, 0.02, 0.03, 0.04].map((tick) =>
                    Math.round((tick + compensationDelaySec) * sampleRate)
                );
                expect(writes.map(({ frame }) => frame)).toEqual(outputFrames);
                for (const [index, value] of [4, 4.24, 7.344, 9.2064, 9.52384].entries()) {
                    expect(writes[index]?.value).toBeCloseTo(value, 5);
                }
            }
        );
    }

    it('uses a fresh arbitrary region and does not reset shared slew at a tempo change', () => {
        const { target, binding } = audioBinding();
        run(binding, [plan((beat) => beat), plan((beat) => beat + 20)], [], undefined, {
            regionStartSeconds: 2,
            regionStartBeat: 4,
            projectSecondsToBeat: (seconds) => (seconds < 0.01 ? 4 + seconds * 2 : 4.02 + (seconds - 0.01) * 4),
            changes: [{ beat: 4.02, tempo: 240 }],
        });
        for (const [index, value] of [12, 14.8928, 15.959808].entries()) {
            expect(target.writes[index]?.value).toBeCloseTo(value, 10);
        }
    });
});
