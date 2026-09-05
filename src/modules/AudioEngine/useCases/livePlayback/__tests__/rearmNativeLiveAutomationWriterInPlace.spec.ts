/**
 * What an in-place re-arm re-reads (#3568, #3575).
 *
 * Nothing that decides the answer is doubled: the real arm, the real producer,
 * the real stores. A chain re-arm exists precisely because a plugin reached
 * project truth after the pass was taken, so a double for the producer — or for
 * the re-arm itself — would stand exactly where the question is.
 *
 * The order the case is staged in is the order the mirror runs it: the project
 * chain changes first, the engine reports the chain it now holds, and the
 * re-arm follows. A device on project truth that the engine does not report is
 * still Web Audio's, which is a different case and belongs to
 * `isDeviceCarriedByNativeSession`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { trackStore, type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { armNativeLiveAutomationWriter } from '../armNativeLiveAutomationWriter';
import { nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { rearmNativeLiveAutomationWriterInPlace } from '../rearmNativeLiveAutomationWriterInPlace';

const SAMPLE_RATE = 48_000;
const SECONDS_PER_BEAT = 0.5;
const STRIP_ID = 'track-1';

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

function hostedDevice(id: string, instanceId: string): Device {
    return {
        id,
        name: id,
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalInstanceId: instanceId,
    };
}

const FIRST_PLUGIN = hostedDevice('plugin-1', 'instance-1');
/** The plugin the engineer drops into the chain mid-take. */
const SECOND_PLUGIN = hostedDevice('plugin-2', 'instance-2');

function trackHolding(devices: readonly Device[]): Track {
    return {
        id: STRIP_ID,
        name: 'Lead',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [...devices],
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
}

type StoredAutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

/** A lane on the plugin's own parameter 7, which is how a hosted id is spelled. */
function hostedLane(deviceId: string): StoredAutomationLane {
    return {
        id: `lane-${deviceId}`,
        trackId: STRIP_ID,
        parameterId: `${deviceId}:7`,
        parameterName: `${deviceId}:7`,
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
}

/** Which devices the pass in flight is currently stamping, in target order. */
function passDeviceIds(): readonly string[] {
    return (nativeLiveAutomationWriter.pass?.targets ?? []).flatMap((slot) =>
        slot.target.kind === 'device-parameter' ? [slot.target.deviceId] : []
    );
}

function publishProjectChain(devices: readonly Device[]): void {
    trackStore.set({ tracks: [trackHolding(devices)], selectedTrackId: null, ghostClips: [] });
}

function publishEngineChain(deviceIds: readonly string[]): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map([[STRIP_ID, [...deviceIds]]]);
}

beforeEach(() => {
    offlinePpqEndpointProjectorState.project = projectPpqEndpoints;
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, parameterId) => parameterId === '7';
    offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => value;
    offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
    automationStore.set({ lanes: [hostedLane(FIRST_PLUGIN.id), hostedLane(SECOND_PLUGIN.id)] });
    // No backend, so the arm's own pump returns before it sends anything: what
    // this file is about is the projection the pass holds, not the batch.
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.loopRegion = null;
    nativeLiveGraphSession.loopEnabled = false;
    nativeLiveGraphSession.carriedStripIds = new Set([STRIP_ID]);
    publishProjectChain([FIRST_PLUGIN]);
    publishEngineChain([FIRST_PLUGIN.id]);
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = null;
    offlineDeviceParameterLawState.clampExternalPluginValue = null;
    offlineDeviceParameterLawState.quantiseValue = null;
    automationStore.set({ lanes: [] });
    trackStore.set(null);
    nativeLiveAutomationWriter.pass = null;
    nativeLiveAutomationWriter.pendingRearm = null;
    nativeLiveGraphSession.carriedStripIds = new Set();
    nativeLiveGraphSession.nativeChainByStripId = new Map();
});

function armOverTheFirstPlugin(): void {
    armNativeLiveAutomationWriter({
        stripTracks: [trackHolding([FIRST_PLUGIN])],
        sampleRate: SAMPLE_RATE,
        programmeEndSeconds: 8,
        positionSeconds: 0,
        provenAfterBatch: null,
    });
}

describe('rearmNativeLiveAutomationWriterInPlace', () => {
    it('carries a plugin spliced into the chain after the pass was armed', () => {
        armOverTheFirstPlugin();

        expect(passDeviceIds()).toEqual([FIRST_PLUGIN.id]);

        publishProjectChain([FIRST_PLUGIN, SECOND_PLUGIN]);
        publishEngineChain([FIRST_PLUGIN.id, SECOND_PLUGIN.id]);

        rearmNativeLiveAutomationWriterInPlace({ provenAfterBatch: 4 });

        // Without this the strip is stranded: the pass carries no stamp for the
        // new plugin, while the tick path reads it as the engine's and stops
        // writing it over IPC — so neither engine drives it until the next play.
        expect(passDeviceIds()).toEqual([FIRST_PLUGIN.id, SECOND_PLUGIN.id]);
    });

    it('keeps the strip set the session built when a strip leaves project truth', () => {
        armOverTheFirstPlugin();

        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        rearmNativeLiveAutomationWriterInPlace({ provenAfterBatch: 4 });

        // `carriedStripIds` still names the strip, so dropping it here would
        // leave its devices driven by neither engine.
        expect(nativeLiveAutomationWriter.pass?.stripTracks.map((track) => track.id)).toEqual([STRIP_ID]);
    });
});
