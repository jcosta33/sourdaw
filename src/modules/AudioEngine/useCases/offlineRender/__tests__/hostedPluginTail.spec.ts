import { beforeEach, describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { defaultExternalPluginTailState, externalPluginTailStore } from '#/modules/PluginHost/stores';

import { notRunningEngineRtDiagnostics } from '../../../models/EngineRtDiagnostics';
import { MAX_AUTO_TAIL_SECONDS } from '../../../services/estimateRenderTailSeconds';
import { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from '../../../stores/engineRtDiagnosticsStore';
import { getAutoDetectedTailSeconds } from '../getAutoDetectedTailSeconds';
import { UNENDING_PLUGIN_TAIL_SAMPLES } from '../hostedPluginTail';

const REVERB_TAIL = { kind: 'decaySeconds', parameterId: 'rev-decay', defaultSeconds: 2 } as const;

/** Stands in for the descriptor lookup the export dialog injects; no hosted type is in it. */
function tailForDeviceType(deviceType: string) {
    return deviceType === 'builtin-reverb' ? REVERB_TAIL : undefined;
}

function hostedTrack(devices: Track['devices']): Track {
    return {
        id: 'track-1',
        name: 'Vocals',
        kind: 'audio',
        muted: false,
        soloed: false,
        disabled: false,
        freezeState: { status: 'unfrozen' },
        outputId: 'master',
        sends: [],
        devices,
    } as unknown as Track;
}

const hostedReverb = {
    id: 'plugin-1',
    name: 'Valhalla',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalPluginId: 'valhalla',
    externalInstanceId: 'inst-1',
};

function engineRunningAt(sampleRate: number): void {
    engineRtDiagnosticsStore.set({
        ...defaultEngineRtDiagnosticsState,
        latest: { ...notRunningEngineRtDiagnostics, running: true, sampleRate },
    });
}

function instanceReportsTail(instanceId: string, tailSamples: number): void {
    externalPluginTailStore.set({ tailSamplesByInstanceId: { [instanceId]: tailSamples } });
}

function detect(devices: Track['devices']) {
    return getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true, tracks: [hostedTrack(devices)] });
}

describe('the export tail of a hosted plugin', () => {
    beforeEach(() => {
        externalPluginTailStore.set(defaultExternalPluginTailState);
        engineRtDiagnosticsStore.set(defaultEngineRtDiagnosticsState);
    });

    it('reserves the tail the instance reported, at the rate the engine activated it at', () => {
        engineRunningAt(44_100);
        instanceReportsTail('inst-1', 132_300);

        expect(detect([hostedReverb]).seconds).toBeCloseTo(3, 9);
    });

    it('cascades a hosted tail into the built-in tail after it on the chain', () => {
        engineRunningAt(48_000);
        instanceReportsTail('inst-1', 48_000);

        const builtinReverb = {
            id: 'rev',
            name: 'Reverb',
            type: 'builtin-reverb',
            bypassed: false,
            parameterValues: {},
        };
        expect(detect([hostedReverb, builtinReverb]).seconds).toBeCloseTo(3, 9);
    });

    it('caps a tail that never ends at the ceiling every unbounded tail gets, and says so', () => {
        engineRunningAt(48_000);
        instanceReportsTail('inst-1', UNENDING_PLUGIN_TAIL_SAMPLES);

        const detected = detect([hostedReverb]);
        expect(detected.seconds).toBe(MAX_AUTO_TAIL_SECONDS);
        expect(detected.clamped).toBe(true);
    });

    it('reads VST3 infinite, the top of the unsigned range, as unending too', () => {
        engineRunningAt(48_000);
        instanceReportsTail('inst-1', 0xffff_ffff);

        expect(detect([hostedReverb]).seconds).toBe(MAX_AUTO_TAIL_SECONDS);
    });

    it('reserves the ceiling when no running engine says which rate the frames are in', () => {
        instanceReportsTail('inst-1', 48_000);

        expect(detect([hostedReverb]).seconds).toBe(MAX_AUTO_TAIL_SECONDS);
    });

    it('reserves nothing for a hosted device whose instance reported no tail', () => {
        engineRunningAt(48_000);
        instanceReportsTail('other-instance', 480_000);

        expect(detect([hostedReverb]).seconds).toBe(0);
    });

    it('reserves nothing for a bypassed hosted device', () => {
        engineRunningAt(48_000);
        instanceReportsTail('inst-1', 480_000);

        expect(detect([{ ...hostedReverb, bypassed: true }]).seconds).toBe(0);
    });
});
