import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { COMPRESSOR_AUTO_MAKEUP_TWIN_NODE } from '../../../../models/DeviceParamLaws';
import { createOfflineDeviceNode } from '../../../deviceNodeFactory';
import { applyLimiterParams } from '../applyLimiterParams';

type CallLog = { mock: { invocationCallOrder: number[] } };
type RecordedShaper = { connect: CallLog; disconnect: CallLog };

function createLimiterNode() {
    const context = createMockAudioContext();
    const deviceNode = createOfflineDeviceNode({
        context: asBaseAudioContext(context),
        deviceType: 'builtin-limiter',
    });
    if (!deviceNode) {
        throw new Error('Expected builtin-limiter factory');
    }
    // The mock's nodes carry a bare context stub; the twin is built from the node's own context.
    Object.defineProperty(deviceNode.namedNodes?.comp, 'context', { value: context });
    const trim = deviceNode.namedNodes?.autoMakeupTrim as GainNode | undefined;
    if (!trim) {
        throw new Error('Expected the limiter to name its Auto Makeup trim');
    }
    return { context, deviceNode, trim };
}

function lastCall(log: CallLog): number {
    return Math.max(0, ...log.mock.invocationCallOrder);
}

function isConnected(shaper: RecordedShaper): boolean {
    return lastCall(shaper.connect) > lastCall(shaper.disconnect);
}

/** The reciprocal is the last shaper built; the ceiling clipper is the first. */
function reciprocalShaper(context: ReturnType<typeof createMockAudioContext>): RecordedShaper {
    const results = context.createWaveShaper.mock.results;
    const reciprocal = results.length > 1 ? (results.at(-1)?.value as RecordedShaper | undefined) : undefined;
    if (!reciprocal) {
        throw new Error('Expected switching off to build the reciprocal shaper');
    }
    return reciprocal;
}

describe('applyLimiterParams Auto Makeup switch', () => {
    it('drives the trim with the reciprocal when the switch goes off, and returns it to unity when on', () => {
        const { context, deviceNode, trim } = createLimiterNode();

        applyLimiterParams(deviceNode, { 'lim-auto-makeup': 0 });
        const reciprocal = reciprocalShaper(context);

        expect(trim.gain.value).toBe(0);
        expect(isConnected(reciprocal)).toBe(true);

        applyLimiterParams(deviceNode, { 'lim-auto-makeup': 1 });

        expect(trim.gain.value).toBe(1);
        expect(isConnected(reciprocal)).toBe(false);
    });

    it('leaves a write that never names the switch on the node’s own makeup, as a limiter stored before it', () => {
        const { context, deviceNode, trim } = createLimiterNode();

        applyLimiterParams(deviceNode, { 'lim-threshold': -24, 'lim-release': 100, 'lim-ceiling': -0.3 });

        expect(trim.gain.value).toBe(1);
        expect(context.createConstantSource).not.toHaveBeenCalled();
        expect(deviceNode.namedNodes?.[COMPRESSOR_AUTO_MAKEUP_TWIN_NODE]).toBeUndefined();
    });

    it('mirrors the limiter’s threshold, release and fixed ratio, knee and attack onto the twin', () => {
        const { deviceNode } = createLimiterNode();

        applyLimiterParams(deviceNode, { 'lim-auto-makeup': 0, 'lim-threshold': -24, 'lim-release': 250 });
        const twin = deviceNode.namedNodes?.[COMPRESSOR_AUTO_MAKEUP_TWIN_NODE] as DynamicsCompressorNode | undefined;
        if (!twin) {
            throw new Error('Expected Auto Makeup off to build the twin');
        }
        applyLimiterParams(deviceNode, { 'lim-threshold': -12 });

        expect(twin.threshold.value).toBe(-12);
        expect(twin.release.value).toBe(0.25);
        expect(twin.ratio.value).toBe(20);
        expect(twin.knee.value).toBe(0);
        expect(twin.attack.value).toBe(0.001);
    });

    it('places the trim between the limiter’s compressor and its ceiling, so the clip cap still follows it', () => {
        const { deviceNode, trim } = createLimiterNode();
        const comp = deviceNode.namedNodes?.comp as unknown as { connectedTo: unknown[] };
        const ceiling = deviceNode.namedNodes?.ceiling;

        expect(comp.connectedTo).toEqual([trim]);
        expect((trim as unknown as { connectedTo: unknown[] }).connectedTo).toEqual([ceiling]);
    });
});
