/**
 * The store binding for the live automation projection, and specifically what
 * it does with the composition-root seam that carries Arrangement's
 * hosted-plugin law (#3568).
 *
 * AudioEngine may not import `Arrangement/useCases`, so the law arrives through
 * `offlineDeviceParameterLawState`, which the composition root fills. An unset
 * seam is not "no law to apply" — it is a projection that cannot tell an
 * automatable plugin parameter from one the plugin never declared, and cannot
 * clamp what it stamps to the instance's published bounds. Admitting a
 * parameter on that footing sends the engine a value nobody bounded, for an id
 * nobody accepted.
 *
 * The projection arithmetic itself belongs to `projectLiveAutomationWrites` and
 * is pinned there; what this file owns is which law reaches it.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { readLiveAutomationWrites } from '../readLiveAutomationWrites';

const SAMPLE_RATE = 48_000;
const SECONDS_PER_BEAT = 0.5;

/** Flat 120 BPM, which is the tempo an unset transport store answers with. */
const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * SECONDS_PER_BEAT * sampleRate);
    const endSamples = Math.round(endPpq * SECONDS_PER_BEAT * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};

const HOSTED_DEVICE: Device = {
    id: 'plugin-1',
    name: 'Compressor',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalInstanceId: 'instance-1',
};

const TRACK: Track = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [HOSTED_DEVICE],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'hw_out',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

/** The lane shape the store holds, which is the one this reader takes them from. */
type StoredAutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

/** A lane on the plugin's own parameter 7, which is how a hosted id is spelled. */
const HOSTED_LANE: StoredAutomationLane = {
    id: 'lane-plugin-7',
    trackId: TRACK.id,
    parameterId: 'plugin-1:7',
    parameterName: 'plugin-1:7',
    enabled: true,
    visible: true,
    collapsed: false,
    objects: [],
    minValue: 0,
    maxValue: 1,
    points: [
        { beat: 0, value: 0.2, curve: 'step', tension: 0 },
        { beat: 2, value: 0.8, curve: 'step', tension: 0 },
    ],
};

function fillSeam(): void {
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = () => true;
    offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => value;
    offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
}

function emptySeam(): void {
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = null;
    offlineDeviceParameterLawState.clampExternalPluginValue = null;
    offlineDeviceParameterLawState.quantiseValue = null;
}

function readOneRegion(): ReturnType<typeof readLiveAutomationWrites> {
    return readLiveAutomationWrites({
        stripTracks: [TRACK],
        sampleRate: SAMPLE_RATE,
        regionStartSeconds: 0,
        regionEndSeconds: 4,
    });
}

beforeEach(() => {
    offlinePpqEndpointProjectorState.project = projectPpqEndpoints;
    automationStore.set({ lanes: [HOSTED_LANE] });
    // The session is sounding this plugin: the two other conditions a hosted
    // parameter needs are met, so the seam is the only thing left to decide it.
    nativeLiveGraphSession.carriedStripIds = new Set([TRACK.id]);
    nativeLiveGraphSession.nativeChainByStripId = new Map([[TRACK.id, [HOSTED_DEVICE.id]]]);
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    emptySeam();
    automationStore.set({ lanes: [] });
    nativeLiveGraphSession.carriedStripIds = new Set();
    nativeLiveGraphSession.nativeChainByStripId = new Map();
});

describe('readLiveAutomationWrites', () => {
    it('carries a hosted plugin lane once the composition root has filled the parameter-law seam', () => {
        fillSeam();

        const result = readOneRegion();

        expect(result.entries.find((entry) => entry.target.kind === 'device-parameter')?.target).toEqual({
            kind: 'device-parameter',
            trackId: TRACK.id,
            deviceId: HOSTED_DEVICE.id,
            parameterId: '7',
        });
    });

    it('admits no hosted plugin lane while the parameter-law seam is unset', () => {
        emptySeam();

        const result = readOneRegion();

        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });
});
