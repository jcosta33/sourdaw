import { describe, expect, it } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { createMyceliumAutomation } from '../createMyceliumAutomation';
import { createMyceliumTopology } from '../createMyceliumTopology';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAD_NAMES =
    'Kick|Snare|Closed HH|Open HH|Clap|Rim|Low Tom|Mid Tom|Hi Tom|Crash|Ride|Cowbell|Clave|Shaker|Perc 1|Perc 2'.split(
        '|'
    );
function valueAt(points: Array<{ beat: number; value: number }>, beat: number): number | undefined {
    return points.find((point) => point.beat === beat)?.value;
}

function valueBetween(
    points: Array<Parameters<typeof evaluateAutomationCurve>[0]['firstPoint']>,
    firstBeat: number,
    secondBeat: number,
    beat: number
): number {
    const firstPoint = points.find((point) => point.beat === firstBeat);
    const secondPoint = points.find((point) => point.beat === secondBeat);
    if (!firstPoint || !secondPoint) {
        throw new Error(`Expected Mycelium automation segment ${String(firstBeat)}–${String(secondBeat)}`);
    }
    return evaluateAutomationCurve({ firstPoint, secondPoint, beat });
}

describe('createMyceliumAutomation', () => {
    it('builds dense, bounded, collision-free automation coverage', () => {
        const { tracks } = createMyceliumTopology();
        const result = createMyceliumAutomation(tracks);
        const { lanes } = result;
        const trackById = new Map(tracks.map((track) => [track.id, track]));
        const laneKeys = lanes.map((lane) => `${lane.trackId}:${lane.parameterId}`);

        expect(lanes).toHaveLength(115);
        expect(lanes.reduce((total, lane) => total + lane.points.length, 0)).toBe(1_651);
        expect(new Set(lanes.map((lane) => lane.trackId)).size).toBe(39);
        expect(lanes.every((lane) => UUID_PATTERN.test(lane.id))).toBe(true);
        expect(new Set(lanes.map((lane) => lane.id)).size).toBe(lanes.length);
        expect(new Set(laneKeys).size).toBe(lanes.length);

        for (const lane of lanes) {
            expect(trackById.has(lane.trackId)).toBe(true);
            expect(lane.points.length).toBeGreaterThanOrEqual(2);
            expect(new Set(lane.points.map((point) => point.value)).size).toBeGreaterThanOrEqual(2);
            expect(lane.points.map((point) => point.beat)).toEqual(
                lane.points.map((point) => point.beat).toSorted((first, second) => first - second)
            );
            for (const point of lane.points) {
                expect(Number.isFinite(point.beat)).toBe(true);
                expect(Number.isFinite(point.value)).toBe(true);
                expect(point.beat).toBeGreaterThanOrEqual(0);
                expect(point.beat).toBeLessThanOrEqual(576);
                expect(point.value).toBeGreaterThanOrEqual(lane.minValue);
                expect(point.value).toBeLessThanOrEqual(lane.maxValue);
            }
        }
        expect(result).toEqual(createMyceliumAutomation(tracks));
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });

    it('covers the required track, Toaster, spatial, synth, and master targets', () => {
        const topology = createMyceliumTopology();
        const { tracks, lanes } = createMyceliumAutomation(topology.tracks);
        const trackByName = new Map(tracks.map((track) => [track.name, track]));
        const laneKeys = new Set(lanes.map((lane) => `${lane.trackId}:${lane.parameterId}`));

        for (const padName of PAD_NAMES) {
            const pad = trackByName.get(padName);
            expect(pad).toBeDefined();
            expect(laneKeys.has(`${pad?.id ?? ''}:gain`)).toBe(true);
        }

        const pulse = trackByName.get('Pulse Engine');
        const toaster = pulse?.devices.find((device) => device.type === 'toaster');
        expect(toaster).toBeDefined();
        for (const parameterId of ['masterGain', 'swing', 'reverbMix', 'delayMix']) {
            expect(laneKeys.has(`${pulse?.id ?? ''}:${toaster?.id ?? ''}:${parameterId}`)).toBe(true);
        }

        const bassNames = new Set(['Sub Mycelium', 'Rolling Colony', 'Acid Tendril']);
        const pannedNames = lanes
            .filter((lane) => lane.parameterId === 'pan')
            .map((lane) => tracks.find((track) => track.id === lane.trackId)?.name);
        expect(pannedNames).toHaveLength(12);
        expect(pannedNames.every((name) => name !== undefined && !bassNames.has(name))).toBe(true);

        const automatedParameters = new Set(
            lanes.map((lane) => lane.parameterId.slice(lane.parameterId.indexOf(':') + 1))
        );
        const requiredParameters =
            'filterCutoff|filterResonance|lfoRate|lfoFilterAmount|fmLevel2|msegToFilter|grainDensity|grainSize|grainSpray|filter-cutoff|filter-resonance|dist-mix|delay-feedback|delay-mix|decay|autopan-rate|autopan-depth|phaser-rate|phaser-depth|chorus-rate|chorus-depth|trem-rate|trem-depth|width-amount'.split(
                '|'
            );
        expect(requiredParameters.every((parameterId) => automatedParameters.has(parameterId))).toBe(true);
        expect(lanes.every((lane) => !lane.parameterId.toLowerCase().includes('pattern'))).toBe(true);
    });

    it('seeds every canonical device target from the public registered parameter contract', () => {
        const input = createMyceliumTopology().tracks;
        const original = structuredClone(input);
        const { tracks, lanes } = createMyceliumAutomation(input);
        const descriptors = new Map(getBuiltinPlugins().map((descriptor) => [descriptor.id, descriptor]));

        for (const lane of lanes) {
            if (lane.parameterId === 'gain' || lane.parameterId === 'pan') {
                continue;
            }
            const separator = lane.parameterId.indexOf(':');
            expect(separator).toBeGreaterThan(0);
            const deviceId = lane.parameterId.slice(0, separator);
            const parameterId = lane.parameterId.slice(separator + 1);
            const track = tracks.find((candidate) => candidate.id === lane.trackId);
            const device = track?.devices.find((candidate) => candidate.id === deviceId);
            const descriptor = device ? descriptors.get(device.type) : undefined;
            const parameter = descriptor?.parameters.find((candidate) => candidate.id === parameterId);

            expect(device).toBeDefined();
            expect(parameter?.automatable).toBe(true);
            expect(lane.minValue).toBeGreaterThanOrEqual(parameter?.minValue ?? Infinity);
            expect(lane.maxValue).toBeLessThanOrEqual(parameter?.maxValue ?? -Infinity);
            expect(device?.parameterValues[parameterId]).toEqual(expect.any(Number));
            expect(device?.parameterValues[parameterId]).toBeGreaterThanOrEqual(parameter?.minValue ?? Infinity);
            expect(device?.parameterValues[parameterId]).toBeLessThanOrEqual(parameter?.maxValue ?? -Infinity);
        }
        expect(input).toEqual(original);
    });

    it('encodes clear windows, dry/wet answers, the false drop, dissolution order, and width contractions', () => {
        const result = createMyceliumAutomation(createMyceliumTopology().tracks);
        const trackByName = new Map(result.tracks.map((track) => [track.name, track]));
        function gainLane(name: string) {
            return result.lanes.find(
                (lane) => lane.trackId === trackByName.get(name)?.id && lane.parameterId === 'gain'
            );
        }

        for (const name of ['Kick', 'Rolling Colony']) {
            const lane = gainLane(name);
            expect(valueAt(lane?.points ?? [], 191.75)).toBe(0);
            expect(valueAt(lane?.points ?? [], 192)).toBeGreaterThan(0);
            expect(valueAt(lane?.points ?? [], 415.75)).toBe(0);
            expect(valueAt(lane?.points ?? [], 416)).toBeGreaterThan(0);
            expect(valueAt(lane?.points ?? [], 479.75)).toBeGreaterThan(0);
            expect(valueAt(lane?.points ?? [], 480)).toBe(0);
            expect(lane?.points.find((point) => point.beat === 480)?.curve).toBe('step');
            expect(valueAt(lane?.points ?? [], 483.75)).toBe(0);
            expect(lane?.points.find((point) => point.beat === 483.75)?.curve).toBe('step');
            expect(valueAt(lane?.points ?? [], 484)).toBeGreaterThan(0);
            expect(lane?.points.find((point) => point.beat === 484)?.curve).toBe('linear');
            expect(valueBetween(lane?.points ?? [], 483.75, 484, 483.875)).toBe(0);
        }
        expect(valueAt(gainLane('Sub Mycelium')?.points ?? [], 288)).toBe(0);
        expect(valueAt(gainLane('Sub Mycelium')?.points ?? [], 316)).toBe(0);
        expect(valueAt(gainLane('Sub Mycelium')?.points ?? [], 480)).toBe(0);
        expect(valueAt(gainLane('Dub Tunnel')?.points ?? [], 412)).toBeGreaterThan(
            valueAt(gainLane('Dub Tunnel')?.points ?? [], 416) ?? 1
        );
        for (const returnName of ['Temple Chamber', 'Dub Tunnel', 'Mutation Return', 'Parallel Crush']) {
            const points = gainLane(returnName)?.points ?? [];
            expect(valueAt(points, 223.75)).toBe(valueAt(points, 192));
            expect(points.find((point) => point.beat === 223.75)?.curve).toBe('step');
            expect(valueAt(points, 224)).toBeGreaterThan(valueAt(points, 223.75) ?? 1);
            expect(points.find((point) => point.beat === 224)?.curve).toBe('step');
            expect(valueBetween(points, 223.75, 224, 223.875)).toBe(valueAt(points, 223.75));
            expect(valueAt(points, 255.75)).toBe(valueAt(points, 224));
            expect(points.find((point) => point.beat === 255.75)?.curve).toBe('step');
            expect(valueAt(points, 256)).toBeLessThan(valueAt(points, 255.75) ?? 0);
            expect(points.find((point) => point.beat === 256)?.curve).toBe('step');
            expect(valueBetween(points, 255.75, 256, 255.875)).toBe(valueAt(points, 255.75));
            expect(valueAt(points, 287.75)).toBe(valueAt(points, 256));
        }
        const kickPoints = gainLane('Kick')?.points ?? [];
        expect(valueBetween(kickPoints, 484, 544, 514)).toBeLessThan(valueAt(kickPoints, 484) ?? 0);
        expect(valueBetween(kickPoints, 484, 544, 514)).toBeGreaterThan(valueAt(kickPoints, 544) ?? 1);
        expect(valueAt(gainLane('Kick')?.points ?? [], 560)).toBe(0);
        expect(valueAt(gainLane('Rolling Colony')?.points ?? [], 560)).toBeGreaterThan(0);
        expect(valueAt(gainLane('Rolling Colony')?.points ?? [], 568)).toBeGreaterThan(0);
        expect(valueAt(gainLane('Rolling Colony')?.points ?? [], 576)).toBe(0);
        expect(result.lanes.some((lane) => lane.parameterId.endsWith(':mix'))).toBe(false);
        const master = trackByName.get('Master');
        const widener = master?.devices.find((device) => device.type === 'builtin-stereo-widener');
        const widthLane = result.lanes.find(
            (lane) => lane.trackId === master?.id && lane.parameterId === `${widener?.id ?? ''}:width-amount`
        );
        expect(valueAt(widthLane?.points ?? [], 191.75)).toBeLessThan(valueAt(widthLane?.points ?? [], 192) ?? 0);
        expect(valueAt(widthLane?.points ?? [], 415.75)).toBeLessThan(valueAt(widthLane?.points ?? [], 416) ?? 0);
    });
});
