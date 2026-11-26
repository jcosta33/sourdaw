import { getHeads, getObjectId } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    sanitizeTrackSnapshot,
    trackStore,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type GrinderFactoryPresetAction } from '../../../events/grinderAppActions';
import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { getGrinderState, grinderStore, loadGrinderPatch } from '../../../stores/grinderStore';
import { applyRectifierHeavyRuntime } from '../applyRectifierHeavyRuntime';
import { buildRectifierHeavyPlayback } from '../buildRectifierHeavyPlayback';
import { encodeGrinderPatchCommands } from '../encodeGrinderPatchCommands';
import { getRectifierHeavyPresetImage } from '../getRectifierHeavyPresetImage';
import { paramBatcher } from '../helpers';

const target = {
    trackId: 'track',
    deviceId: 'grinder',
    deviceIds: ['grinder', 'sentinel'],
    ownerIncarnation: { trackObjectId: 'track-object', deviceObjectId: 'device-object' },
};

function rectifierAction(
    before: Record<string, number>,
    direction?: 'undo'
): GrinderFactoryPresetAction['payload'] & { after: Readonly<Record<string, number>> } {
    const factory = getRectifierHeavyPresetImage();
    if (!factory) {
        throw new Error('Rectifier Heavy is missing');
    }
    const after = factory.parameterValues;
    return {
        ...target,
        presetId: 'gr-rectifier-heavy',
        before: Object.fromEntries(Object.keys(after).map((key) => [key, before[key] ?? null])),
        after,
        direction,
    };
}

describe('Rectifier Heavy live playback', () => {
    it('sends only the emitted footprint and keeps an active overlay separate from the authored gain', () => {
        const payload = rectifierAction({});
        const readEffective = vi.fn((_trackId: string, _deviceId: string, key: string) =>
            key === 'gain' ? 3.4 : undefined
        );
        const playback = buildRectifierHeavyPlayback(payload, payload.after, readEffective);

        expect(
            Object.fromEntries(playback.web.parameters.map(({ parameterId, value }) => [parameterId, value]))
        ).toEqual(payload.after);
        expect(playback.web.neural).toEqual({ neuralModelMode: 'builtin' });
        expect(playback.web.overrides).toEqual([{ parameterId: 'gain', value: 3.4 }]);
        expect(playback.native.values.gain).toBe(3.4);
        expect(playback.native.resetParameterIds).toEqual([]);
        expect(readEffective).toHaveBeenCalledWith('track', 'grinder', 'gain');
        expect(readEffective).not.toHaveBeenCalledWith('track', 'sentinel', expect.any(String));
    });

    it('restores absent DSP constructor settings and leaves present settings or active controls explicit', () => {
        const before = { gain: 5, gateAttack: 2, ampModel: 3, cabIrSlot: 1, routingMode: 2, neuralModelSlot: 2 };
        const replay = buildRectifierHeavyPlayback(rectifierAction(before, 'undo'), before, (_, __, key) =>
            key === 'gateRelease' ? 80 : undefined
        );

        expect(replay.web.parameters).toEqual(
            expect.arrayContaining([
                { parameterId: 'gain', value: 5 },
                { parameterId: 'ampModel', value: 3 },
                { parameterId: 'cabIrSlot', value: 1 },
                { parameterId: 'routingMode', value: 2 },
                { parameterId: 'mic2PositionY', value: 0.3 },
                { parameterId: 'mic2Distance', value: 0.5 },
                { parameterId: 'preOverdriveTone', value: 5.5 },
                { parameterId: 'postCompressorThreshold', value: -20 },
                { parameterId: 'transformerDrive', value: 0.3 },
            ])
        );
        expect(replay.web.resetParameterIds).toEqual([
            'couplingCapCharge',
            'transformerHysteresis',
            'transformerLfSaturation',
        ]);
        expect(replay.native.resetParameterIds).toEqual([
            'couplingCapCharge',
            'transformerDrive',
            'transformerHysteresis',
            'transformerLfSaturation',
        ]);
        expect(replay.native.values).toMatchObject({ gateAttack: 2, gateRelease: 80, neuralModelSlot: 2 });
        expect(replay.native.values).not.toHaveProperty('transformerDrive');
        expect(Object.keys(replay.native.values).at(-1)).toBe('neuralModelSlot');
    });

    it('restores the imported scalar profile in native order without sending digest metadata as DSP controls', () => {
        const imported = encodeGrinderPatchCommands({
            ...DEFAULT_PATCH,
            neuralModelSource: 'imported',
            neuralModelProfile: {
                derivedFrom: 'nam',
                sourceArchitecture: 'lstm',
                sourceSampleRate: 48_000,
                sourceWeightCount: 0,
                preferredTier: 'lite',
                inputDrive: 1.2,
                asymmetry: 0.1,
                outputTrim: 0.9,
                contourMix: 0.3,
                recurrentBias: 0.05,
                convWeights: Array.from({ length: 10 }, () => [0.1, 0.2, 0.3]),
                model: null,
                modelDigest: null,
            },
        });
        const before = Object.fromEntries(
            imported.flatMap((entry) => (entry.kind === 'parameter' ? [[entry.key, entry.value]] : []))
        );
        const replay = buildRectifierHeavyPlayback(rectifierAction(before, 'undo'), before, () => undefined);
        const nativeKeys = Object.keys(replay.native.values);

        expect(replay.web.neural).toMatchObject({ neuralModelMode: 'imported' });
        expect(replay.native.modelJson).toBeNull();
        expect(replay.native.values).toMatchObject({
            neuralModelMode: 1,
            neuralCustomInputDrive: 1.2,
            neuralCustomConvWeight9_2: 0.3,
        });
        expect(nativeKeys[0]).toBe('neuralEnabled');
        expect(nativeKeys.indexOf('neuralTier')).toBeLessThan(nativeKeys.indexOf('neuralCustomTier'));
        expect(nativeKeys.at(-1)).toBe('neuralModelMode');
        expect(nativeKeys.some((key) => key.startsWith('neuralCustomModelDigest'))).toBe(false);
    });
});

type RuntimePorts = Parameters<typeof applyRectifierHeavyRuntime>[1];
type RuntimeRoot = { tracks: Pick<TrackStoreState, 'tracks'> };
type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };

function committedRoot() {
    const root = getCrdtDoc<RuntimeRoot>('root');
    if (!root) {
        throw new Error('Expected a committed project root');
    }
    return root;
}

function commitRack(trackId: string, parameterValues: Readonly<Record<string, number>> | null): void {
    const neighbor = {
        id: 'sentinel',
        type: 'grinder',
        name: 'Neighbor',
        bypassed: false,
        parameterValues: { gain: 2 },
    };
    const grinder = { id: target.deviceId, type: 'grinder', name: 'Amp', bypassed: false, parameterValues };
    const snapshot = sanitizeTrackSnapshot({
        tracks: [
            {
                id: trackId,
                name: 'Guitar',
                kind: 'folder',
                devices: parameterValues ? [grinder, neighbor] : [neighbor],
            },
        ],
    });
    trackStore.set({ ...defaultTrackState, tracks: snapshot.tracks });
    flushAutomergeStorageWrites();
}

function commitPresetImage(before: Record<string, number>, direction?: 'undo'): ReturnType<typeof rectifierAction> {
    const payload = rectifierAction(before, direction);
    commitRack(target.trackId, direction === 'undo' ? before : payload.after);
    const track = committedRoot().tracks.tracks.find(({ id }) => id === target.trackId);
    const device = track?.devices.find(({ id }) => id === target.deviceId);
    const trackObjectId = track && getObjectId(track);
    const deviceObjectId = device && getObjectId(device);
    if (!trackObjectId || !deviceObjectId) {
        throw new Error('Expected the committed Grinder and its owner');
    }
    return { ...payload, ownerIncarnation: { trackObjectId, deviceObjectId } };
}

function playbackPorts() {
    return {
        play: vi.fn<RuntimePorts['play']>().mockResolvedValue(undefined),
        readEffectiveValue: vi.fn<RuntimePorts['readEffectiveValue']>(),
    };
}

describe('applyRectifierHeavyRuntime', () => {
    const notify = vi.fn<(notification: NotifyPayload) => void>();

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Rectifier live playback');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        loadGrinderPatch(target.deviceId, { ...DEFAULT_PATCH, name: 'Saved guitar tone', gain: 1 });
        loadGrinderPatch('sentinel', { ...DEFAULT_PATCH, name: 'Neighbor tone', gain: 2 });
        notify.mockClear();
        const bus = createEventBus<NotificationEvents>();
        bus.on('ui.notify', notify);
        setNotificationEventBus(bus);
        vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        paramBatcher.cancelAll();
        grinderStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        vi.restoreAllMocks();
    });

    it('sends one ordered installation with live overrides, keeps authored values, and cancels only its queued controls', async () => {
        const payload = commitPresetImage({ gain: 1 });
        const before = getGrinderState(target.deviceId);
        const neighbor = getGrinderState('sentinel');
        const heads = getHeads(committedRoot());
        const ownedFlush = vi.fn();
        const neighborFlush = vi.fn();
        const neighborWrite = { deviceId: 'sentinel', key: 'gain', value: 5 };
        paramBatcher.schedule(
            `${target.deviceId}:gain`,
            { deviceId: target.deviceId, key: 'gain', value: 1 },
            ownedFlush
        );
        paramBatcher.schedule('sentinel:gain', neighborWrite, neighborFlush);
        const playback = playbackPorts();
        playback.readEffectiveValue.mockImplementation((_trackId, _deviceId, parameter) =>
            parameter === 'gain' ? 3.4 : undefined
        );

        await applyRectifierHeavyRuntime(payload, playback);

        expect(playback.play).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                trackId: target.trackId,
                deviceId: target.deviceId,
                web: {
                    parameters: Object.entries(payload.after).map(([parameterId, value]) => ({ parameterId, value })),
                    overrides: [{ parameterId: 'gain', value: 3.4 }],
                    neural: { neuralModelMode: 'builtin' },
                    resetParameterIds: [],
                },
                native: expect.objectContaining({ values: expect.objectContaining({ gain: 3.4 }) }),
            })
        );
        expect(playback.readEffectiveValue).toHaveBeenCalledWith(target.trackId, target.deviceId, 'gain');
        expect(getGrinderState(target.deviceId)).toMatchObject({
            basePatch: before.basePatch,
            patch: { name: 'Rectifier Heavy', gain: payload.after.gain },
        });
        expect(getGrinderState('sentinel')).toEqual(neighbor);
        expect(getHeads(committedRoot())).toEqual(heads);
        await vi.waitFor(() => expect(neighborFlush).toHaveBeenCalledExactlyOnceWith('sentinel:gain', neighborWrite));
        expect(ownedFlush).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('matches the exact legacy Undo image before clamping playback and keeps its saved name', async () => {
        const payload = commitPresetImage({ gain: 5, master: 999 }, 'undo');
        const playback = playbackPorts();
        const heads = getHeads(committedRoot());

        await applyRectifierHeavyRuntime(payload, playback);

        expect(playback.play).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                trackId: target.trackId,
                deviceId: target.deviceId,
                web: expect.objectContaining({
                    parameters: expect.arrayContaining([
                        { parameterId: 'gain', value: 5 },
                        { parameterId: 'master', value: 10 },
                    ]),
                    resetParameterIds: expect.arrayContaining(['gateRelease']),
                }),
                native: expect.objectContaining({ values: expect.objectContaining({ gain: 5, master: 10 }) }),
            })
        );
        expect(getGrinderState(target.deviceId).patch).toMatchObject({
            name: 'Saved guitar tone',
            gain: 5,
            master: 10,
        });
        expect(committedRoot().tracks.tracks[0]?.devices[0]?.parameterValues).toEqual({ gain: 5, master: 999 });
        expect(getHeads(committedRoot())).toEqual(heads);
    });

    it.each([
        { scenario: 'missing Grinder', trackId: target.trackId, values: () => null },
        {
            scenario: 'equal values on another owner track',
            trackId: 'peer-track',
            values: (after: Record<string, number>) => after,
        },
        {
            scenario: 'changed committed scalar',
            trackId: target.trackId,
            values: (after: Record<string, number>) => ({ ...after, gain: 2 }),
        },
    ])('declines installation for $scenario', async ({ trackId, values }) => {
        const payload = commitPresetImage({});
        commitRack(trackId, values(payload.after));
        const playback = playbackPorts();
        const before = structuredClone(grinderStore.value);
        const heads = getHeads(committedRoot());

        await applyRectifierHeavyRuntime(payload, playback);

        expect(playback.play).not.toHaveBeenCalled();
        expect(playback.readEffectiveValue).not.toHaveBeenCalled();
        expect(grinderStore.value).toEqual(before);
        expect(getHeads(committedRoot())).toEqual(heads);
        expect(notify).not.toHaveBeenCalled();
    });

    it('refuses Undo installation when a captured absent control is now present', async () => {
        const payload = commitPresetImage({ gain: 5 }, 'undo');
        commitRack(target.trackId, { gain: 5, gateRelease: 100 });
        const playback = playbackPorts();
        const before = structuredClone(grinderStore.value);

        await applyRectifierHeavyRuntime(payload, playback);

        expect(playback.play).not.toHaveBeenCalled();
        expect(grinderStore.value).toEqual(before);
        expect(notify).not.toHaveBeenCalled();
    });

    it('silences an older failure for the same committed image and still reports the current failure', async () => {
        const payload = commitPresetImage({});
        const oldAcknowledgement = Promise.withResolvers<void>();
        const currentAcknowledgement = Promise.withResolvers<void>();
        const playback = playbackPorts();
        playback.play
            .mockReturnValueOnce(oldAcknowledgement.promise)
            .mockReturnValueOnce(currentAcknowledgement.promise);
        const older = applyRectifierHeavyRuntime(payload, playback);
        const current = applyRectifierHeavyRuntime(payload, playback);
        const heads = getHeads(committedRoot());
        expect(playback.play).toHaveBeenCalledTimes(2);

        oldAcknowledgement.reject(new Error('Older installation refused'));
        await older;
        expect(notify).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();

        const error = new Error('Current installation refused');
        currentAcknowledgement.reject(error);
        await current;
        expect(notify).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                message: 'Grinder saved the preset change, but live audio could not confirm it.',
                level: 'warning',
            })
        );
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cause: error }));
        expect(getHeads(committedRoot())).toEqual(heads);
    });

    it('silences a current acknowledgement failure after the committed parameter image changes', async () => {
        const payload = commitPresetImage({});
        const acknowledgement = Promise.withResolvers<void>();
        const playback = playbackPorts();
        playback.play.mockReturnValueOnce(acknowledgement.promise);
        const installation = applyRectifierHeavyRuntime(payload, playback);
        expect(playback.play).toHaveBeenCalledOnce();

        commitRack(target.trackId, { ...payload.after, gain: 2 });
        const heads = getHeads(committedRoot());
        acknowledgement.reject(new Error('Playback overtaken by a project edit'));
        await installation;

        expect(committedRoot().tracks.tracks[0]?.devices[0]?.parameterValues.gain).toBe(2);
        expect(getHeads(committedRoot())).toEqual(heads);
        expect(notify).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });
});
