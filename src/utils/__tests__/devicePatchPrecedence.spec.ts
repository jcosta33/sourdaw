import { describe, expect, it } from 'vitest';

import { orderDeviceParametersForReplay } from '../devicePatchPrecedence';

describe('orderDeviceParametersForReplay', () => {
    it('orders crust parameters with style before algorithm', () => {
        const result = orderDeviceParametersForReplay('crust', { algorithm: 6, style: 2 });
        expect(result).toEqual([
            ['style', 2],
            ['algorithm', 6],
        ]);
    });

    it('orders crust with surrounding parameters preserving rest insertion order', () => {
        const result = orderDeviceParametersForReplay('crust', {
            release: 450,
            algorithm: 6,
            style: 2,
            threshold: -10,
        });
        expect(result).toEqual([
            ['style', 2],
            ['release', 450],
            ['algorithm', 6],
            ['threshold', -10],
        ]);
    });

    it('orders gluten macro keys in declared precedence order', () => {
        const result = orderDeviceParametersForReplay('gluten', {
            amount: 0.5,
            style: 1,
            cutoff: 500,
            topology: 2,
        });
        expect(result).toEqual([
            ['topology', 2],
            ['style', 1],
            ['amount', 0.5],
            ['cutoff', 500],
        ]);
    });

    it('orders grinder parameters with neuralEnabled first', () => {
        const result = orderDeviceParametersForReplay('grinder', {
            drive: 0.8,
            neuralEnabled: 1,
        });
        expect(result).toEqual([
            ['neuralEnabled', 1],
            ['drive', 0.8],
        ]);
    });

    it('orders fermenter parameters with activeLayer first', () => {
        const result = orderDeviceParametersForReplay('fermenter', {
            osc1_pitch: 12,
            activeLayer: 1,
        });
        expect(result).toEqual([
            ['activeLayer', 1],
            ['osc1_pitch', 12],
        ]);
    });

    it('handles case-insensitivity in deviceType matching', () => {
        const lower = orderDeviceParametersForReplay('crust', { algorithm: 6, style: 2 });
        const upper = orderDeviceParametersForReplay('Crust', { algorithm: 6, style: 2 });
        expect(upper).toEqual([
            ['style', 2],
            ['algorithm', 6],
        ]);
        expect(upper).toEqual(lower);
    });

    it('returns parameters in original order for devices with no precedence laws', () => {
        const delayParams = { time: 0.25, feedback: 0.4, mix: 0.3 };
        expect(orderDeviceParametersForReplay('delay', delayParams)).toEqual(Object.entries(delayParams));

        const filterParams = { cutoff: 1200, resonance: 0.7 };
        expect(orderDeviceParametersForReplay('filter', filterParams)).toEqual(Object.entries(filterParams));

        const bacteriaParams = { distortionMode: 0, drive: 0.5, mix: 0.8 };
        expect(orderDeviceParametersForReplay('bacteria', bacteriaParams)).toEqual(Object.entries(bacteriaParams));
    });

    it('behaves cleanly with partial precedence keys', () => {
        const onlyAlgorithm = orderDeviceParametersForReplay('crust', { algorithm: 6 });
        expect(onlyAlgorithm).toEqual([['algorithm', 6]]);

        const onlyStyle = orderDeviceParametersForReplay('crust', { style: 2 });
        expect(onlyStyle).toEqual([['style', 2]]);

        const empty = orderDeviceParametersForReplay('crust', {});
        expect(empty).toEqual([]);
    });

    it('orders toaster pad engine types in pad index order', () => {
        const result = orderDeviceParametersForReplay('toaster', {
            level: 0.8,
            pad3_engine_type: 2,
            pad0_engine_type: 1,
            pitch: 0,
        });
        expect(result).toEqual([
            ['pad0_engine_type', 1],
            ['pad3_engine_type', 2],
            ['level', 0.8],
            ['pitch', 0],
        ]);
    });
});
