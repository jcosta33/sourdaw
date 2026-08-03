import { describe, expect, it } from 'vitest';

import { CRUMBS_DEVICE_STATE_VERSION, fromCrumbsDeviceState, toCrumbsDeviceState } from '../CrumbsDeviceState';

import type { SampleMeta } from '../CrumbsTypes';

function sampleMeta(): SampleMeta {
    return {
        sampleId: 3,
        sampleRate: 48_000,
        channels: 2,
        frameCount: 96_000,
        durationSecs: 2,
        detectedRoot: 62,
        detectedBpm: 174,
        category: 'loop',
        filePath: '/samples/break.wav',
        fileName: 'break.wav',
    };
}

describe('toCrumbsDeviceState', () => {
    it('writes the mode and the whole sample reference under the chunk version', () => {
        expect(toCrumbsDeviceState({ mode: 'slice', activeSample: sampleMeta() })).toEqual({
            version: CRUMBS_DEVICE_STATE_VERSION,
            data: { mode: 'slice', activeSample: sampleMeta() },
        });
    });

    it('writes an explicit null for a device with no sample loaded', () => {
        // Not an omission: a user who cleared the sample has to be able to save that,
        // and an absent key would read back as the previously saved sample.
        expect(toCrumbsDeviceState({ mode: 'quick', activeSample: null }).data.activeSample).toBeNull();
    });
});

describe('fromCrumbsDeviceState', () => {
    it('reads back the mode and sample a live instance wrote', () => {
        const decoded = fromCrumbsDeviceState(toCrumbsDeviceState({ mode: 'drum', activeSample: sampleMeta() }));

        expect(decoded).toEqual({ mode: 'drum', activeSample: sampleMeta() });
    });

    it('rejects a chunk written by a version this build does not know', () => {
        expect(
            fromCrumbsDeviceState({
                version: CRUMBS_DEVICE_STATE_VERSION + 1,
                data: { mode: 'slice', activeSample: sampleMeta() },
            })
        ).toBeNull();
    });

    it('drops a sample reference with no file path rather than restoring a sample nobody can load', () => {
        const { filePath: _filePath, ...withoutPath } = sampleMeta();
        const decoded = fromCrumbsDeviceState({
            version: CRUMBS_DEVICE_STATE_VERSION,
            data: { mode: 'slice', activeSample: withoutPath },
        });

        expect(decoded).toEqual({ mode: 'slice', activeSample: null });
    });

    it('keeps the sample when only the mode is unreadable', () => {
        // The sample decides whether the track makes a sound at all; the mode
        // decides how it is triggered. Losing the second is not a reason to lose
        // the first.
        const decoded = fromCrumbsDeviceState({
            version: CRUMBS_DEVICE_STATE_VERSION,
            data: { mode: 'granular', activeSample: sampleMeta() },
        });

        expect(decoded?.mode).toBe('quick');
        expect(decoded?.activeSample?.filePath).toBe('/samples/break.wav');
    });

    it('coerces a category this build does not recognise rather than dropping the sample', () => {
        const decoded = fromCrumbsDeviceState({
            version: CRUMBS_DEVICE_STATE_VERSION,
            data: { mode: 'quick', activeSample: { ...sampleMeta(), category: 'vocal-chop' } },
        });

        expect(decoded?.activeSample?.category).toBe('unknown');
    });

    it('reads no playback state out of an absent or empty chunk', () => {
        expect(fromCrumbsDeviceState(undefined)).toBeNull();
        expect(fromCrumbsDeviceState({ version: CRUMBS_DEVICE_STATE_VERSION, data: {} })).toBeNull();
        expect(fromCrumbsDeviceState({ version: CRUMBS_DEVICE_STATE_VERSION })).toBeNull();
    });
});
