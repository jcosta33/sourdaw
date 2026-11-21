import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';
import { LEVAIN_CONTROLLER_DEFAULTS } from '#/utils/levainControllerDefaults';

import { capturesNativeCalibration } from '../capturesNativeCalibration';
import { hostsStoredControllers } from '../hostsStoredControllers';
import { readStoredControllerDefault } from '../readStoredControllerDefault';
import { resolveStoredControllerHosting } from '../resolveStoredControllerHosting';

const NOT_BUILTIN = ['faust-organ', '', 'Levain', 'levain-x', 'constructor', '__proto__', 'Grand-Boule'];
const HOSTS = new Set(['grand-boule', 'levain']);

describe('stored controller hosting', () => {
    it('answers the grand boule row as pedal positions with no defaults', () => {
        const hosting = resolveStoredControllerHosting('grand-boule');
        expect(hosting?.controlsKey).toBe('grandBouleControls');
        expect(hosting?.moves).toBe('pedal-positions');
        expect(hosting?.controllerDefaults.size).toBe(0);
    });

    it('answers the levain row as raw controllers with the levain defaults', () => {
        const hosting = resolveStoredControllerHosting('levain');
        expect(hosting?.controlsKey).toBe('levainControls');
        expect(hosting?.moves).toBe('raw-controllers');
        expect(hosting?.controllerDefaults).toBe(LEVAIN_CONTROLLER_DEFAULTS);
    });

    it.each(BUILTIN_DEVICE_TYPES.filter((type) => !HOSTS.has(type)))('answers null for %s', (type) => {
        expect(resolveStoredControllerHosting(type)).toBeNull();
        expect(hostsStoredControllers(type)).toBe(false);
        expect(readStoredControllerDefault(type, 11)).toBeUndefined();
    });

    it.each(NOT_BUILTIN)('answers null for the non-built-in %j', (type) => {
        expect(resolveStoredControllerHosting(type)).toBeNull();
        expect(hostsStoredControllers(type)).toBe(false);
        expect(readStoredControllerDefault(type, 11)).toBeUndefined();
    });

    it('hosts exactly grand boule and levain', () => {
        expect(BUILTIN_DEVICE_TYPES.filter((type) => hostsStoredControllers(type))).toEqual(
            BUILTIN_DEVICE_TYPES.filter((type) => HOSTS.has(type))
        );
    });

    it('reads a levain controller default and none for a controller without one', () => {
        expect(readStoredControllerDefault('levain', 11)).toBe(127);
        expect(readStoredControllerDefault('levain', 7)).toBe(100);
        expect(readStoredControllerDefault('levain', 64)).toBeUndefined();
        expect(readStoredControllerDefault('grand-boule', 11)).toBeUndefined();
    });
});

describe('native calibration capture', () => {
    it('is true for grand boule alone among built-in types', () => {
        expect(BUILTIN_DEVICE_TYPES.filter((type) => capturesNativeCalibration(type))).toEqual(['grand-boule']);
    });

    it.each(NOT_BUILTIN)('is false for the non-built-in %j', (type) => {
        expect(capturesNativeCalibration(type)).toBe(false);
    });
});
