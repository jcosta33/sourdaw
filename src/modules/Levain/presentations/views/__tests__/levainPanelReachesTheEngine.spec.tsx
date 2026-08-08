import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    defaultTrackState,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
    sanitizeTrackSnapshot,
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';

import { levainStore } from '../../../stores/levainStore';
import { type LevainDevice } from '../../../useCases/levainParamBridge/helpers';
import { levainBridge } from '../../../useCases/levainParamBridge/levainBridge';
import { registerLevainDevice } from '../../../useCases/levainParamBridge/registerLevainDevice';
import { prepareOfflineLevain } from '../../../useCases/prepareOfflineLevain';
import { LevainPanel } from '../LevainPanel';

const mocks = vi.hoisted(() => ({
    autoLoadLevainSamples: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../useCases/autoLoadSamples', () => ({
    autoLoadLevainSamples: mocks.autoLoadLevainSamples,
}));

const DEVICE_ID = 'levain-1';

type PostedMessage = { type: string; name?: string; value?: number };

type SetParamMock = Mock<LevainDevice['setParam']>;

function fakePort(): { port: MessagePort; posted: PostedMessage[] } {
    const posted: PostedMessage[] = [];
    const port = {
        postMessage: (message: PostedMessage) => {
            posted.push(message);
        },
    } as unknown as MessagePort;
    return { port, posted };
}

function makeLevainTracks(): Track[] {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Violins',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

/** Last value the live worklet was told for one engine parameter, or undefined. */
function lastLiveValue(setParam: SetParamMock, name: string): number | undefined {
    const call = setParam.mock.calls.findLast((candidate) => candidate[0] === name);
    if (!call) {
        return undefined;
    }
    return call[1];
}

/** Value the offline render will apply for one engine parameter, or undefined. */
function offlineValue(posted: PostedMessage[], name: string): number | undefined {
    return posted.findLast((message) => message.type === 'param' && message.name === name)?.value;
}

/**
 * Click an articulation card in the rail.
 *
 * The name also appears in the "Artic" readout tile once it is selected, so this
 * picks the occurrence that is inside a button rather than relying on DOM order.
 */
function clickArticulation(name: string): void {
    const card = screen.getAllByText(name).find((node) => node.closest('button') !== null);
    if (!card) {
        throw new Error(`No articulation card labelled ${name}`);
    }
    fireEvent.click(card);
}

/**
 * What the panel sends the live engine must be what the export renders.
 *
 * `registerLevainDevice` and `prepareOfflineLevain` both apply the whole patch
 * through `projectLevainPatchToEngineParameters`. The panel's live edits are the
 * only path that applies a subset, so a control the panel forwards to the store
 * but not to the engine does not fail loudly — it produces an export that does
 * not sound like the monitor, with both surfaces reporting the value the user
 * picked.
 *
 * These specs therefore assert live and offline against **each other** rather
 * than against a literal: an assertion that only checked the offline half would
 * already pass today, and one that only counted mock calls would survive a fix
 * that sent the wrong value.
 */
describe('LevainPanel edits reach the live engine', () => {
    let setParam: SetParamMock;
    let rafCallbacks: FrameRequestCallback[];

    /** Run the rAF batch the param bridge coalesces engine writes into. */
    function flushFrames(): void {
        for (const callback of rafCallbacks.splice(0)) {
            callback(0);
        }
    }

    beforeEach(async () => {
        mocks.autoLoadLevainSamples.mockClear();
        mocks.autoLoadLevainSamples.mockImplementation(() => Promise.resolve());
        setParam = vi.fn<LevainDevice['setParam']>();
        rafCallbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        injectDependencies(levainBridge, {
            getAllTracks: () => trackStore.value?.tracks ?? [],
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
            autoLoadLevainSamples: mocks.autoLoadLevainSamples,
        });

        trackStore.set({ ...defaultTrackState, tracks: makeLevainTracks() });
        levainStore.set({});

        await registerLevainDevice(DEVICE_ID, { setParam, handleCc: vi.fn() }, fakePort().port);
        setParam.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends an articulation picked in the rail to the engine the monitor is playing', async () => {
        render(<LevainPanel deviceId={DEVICE_ID} />);

        // Tremolo is articulation id 13 at patch index 2, so this also fails if the
        // engine id ever regresses to the positional index it used to be, and it is
        // not the default (sustain, id 0) — which the engine already holds from
        // registration and would therefore agree on for the wrong reason.
        clickArticulation('Tremolo');

        const { port, posted } = fakePort();
        await prepareOfflineLevain({ deviceId: DEVICE_ID, port });

        expect(offlineValue(posted, 'current_articulation')).toBe(13);
        expect(lastLiveValue(setParam, 'current_articulation')).toBe(offlineValue(posted, 'current_articulation'));
    });

    it('keeps the panel readout on the articulation it sent', () => {
        render(<LevainPanel deviceId={DEVICE_ID} />);

        clickArticulation('Tremolo');

        // The readout is the display name resolved from the patch entry, not the
        // raw type. A fix that reached the engine by routing around the store
        // mutator would send 13 and leave this reading "Long".
        expect(levainStore.value?.[DEVICE_ID]?.currentArticulationDisplay).toBe('Tremolo');
        expect(levainStore.value?.[DEVICE_ID]?.patch.currentArticulation).toBe('tremolo');
    });

    it('does not send to a device the write boundary rejects', () => {
        // Companion negative. Without it, "always call setParam" would satisfy the
        // spec above; Levain writes are gated on the device still being in the
        // project, so a panel left open across a device delete must not resurrect it.
        injectDependencies(levainBridge, {
            getAllTracks: () => [],
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'missing' as const }),
            autoLoadLevainSamples: mocks.autoLoadLevainSamples,
        });
        render(<LevainPanel deviceId={DEVICE_ID} />);

        clickArticulation('Tremolo');

        expect(lastLiveValue(setParam, 'current_articulation')).toBeUndefined();
    });

    it('resends the mic mix to the engine when the instrument changes under it', async () => {
        // M-131. The store is replaced wholesale by the new instrument's defaults,
        // so the panel shows default mics while the engine keeps the previous
        // instrument's — an interior value, not an end, because a clamp at either
        // extreme would agree with the default for the wrong reason.
        render(<LevainPanel deviceId={DEVICE_ID} />);

        levainBridge().sendMicParamToEngine(DEVICE_ID, 0, 'volume', 0.31);
        flushFrames();
        expect(lastLiveValue(setParam, 'mic_0_volume')).toBe(0.31);

        fireEvent.click(screen.getByText('Cellos'));
        flushFrames();

        const { port, posted } = fakePort();
        await prepareOfflineLevain({ deviceId: DEVICE_ID, port });

        expect(offlineValue(posted, 'mic_0_volume')).toBe(0.8);
        expect(lastLiveValue(setParam, 'mic_0_volume')).toBe(offlineValue(posted, 'mic_0_volume'));
    });
});
