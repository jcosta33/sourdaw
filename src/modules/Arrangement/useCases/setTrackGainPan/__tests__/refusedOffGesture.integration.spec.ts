import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initInputMonitoringProjectAccess } from '#/app/initInputMonitoringProjectAccess';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, toggleInputMonitoring } from '#/modules/Arrangement/useCases';
import {
    configureInputMonitoringProjectAccess,
    ensureTrackStrip,
    getAudioContext,
    getTrackStrip,
    removeTrackStrip,
    startInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';
import { createCrdtDoc, getCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { setInputMonitoring } from '../setInputMonitoring';

const getUserMedia = vi.fn();

describe('committed input monitoring through Off gestures', () => {
    const context = getAudioContext();
    const originalMediaDevices = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');
    const originalCreateMediaStreamSource = Object.getOwnPropertyDescriptor(context, 'createMediaStreamSource');
    const originalCreateStereoPanner = Object.getOwnPropertyDescriptor(context, 'createStereoPanner');
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const createMediaStreamSource = vi.fn(() => source as unknown as MediaStreamAudioSourceNode);
    const connected = new Set<unknown>();
    const mediaTrack = { stop: vi.fn() };
    const stream = { getTracks: () => [mediaTrack] };
    const refusal = new Error('Off write refused at commit');
    let refuseCommit = false;
    let unsubscribe: (() => void) | undefined;

    function gainNode(trackId: string): GainNode {
        const gain = getTrackStrip(trackId)?.gainNode;
        if (!gain) {
            throw new Error(`Expected a real strip for ${trackId}`);
        }
        return gain;
    }

    function restoreContextMethod(name: string, descriptor: PropertyDescriptor | undefined): void {
        if (descriptor) {
            Object.defineProperty(context, name, descriptor);
        } else {
            Reflect.deleteProperty(context, name);
        }
    }

    function committedMode(trackId: string): unknown {
        const document = getCrdtDoc<{ tracks: { tracks: Array<{ id: string; inputMonitoring: string }> } }>('root');
        if (!document || !Array.isArray(document.tracks.tracks)) {
            throw new Error('Expected committed tracks');
        }
        return document.tracks.tracks.find((track) => track.id === trackId)?.inputMonitoring;
    }

    function projectedMode(trackId: string): unknown {
        return trackStore.value?.tracks.find((track) => track.id === trackId)?.inputMonitoring;
    }

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        stopInputMonitoring();
        vi.clearAllMocks();
        connected.clear();
        refuseCommit = false;
        createCrdtDoc('root');
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => {
                if (refuseCommit) {
                    throw refusal;
                }
                mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys });
            },
        });
        trackStore.set({
            tracks: ['a', 'b'].map((id) => ({
                ...createTrack({ id, name: `Audio ${id}`, kind: 'audio', withoutDefaultDevice: true }),
                inputMonitoring: 'on' as const,
            })),
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        getUserMedia.mockResolvedValue(stream);
        Object.defineProperty(context, 'createMediaStreamSource', {
            value: createMediaStreamSource,
            configurable: true,
        });
        Object.defineProperty(context, 'createStereoPanner', {
            value: () => ({
                pan: { value: 0 },
                connect: (destination: AudioNode) => destination,
                disconnect: () => {},
            }),
            configurable: true,
        });
        for (const trackId of ['a', 'b']) {
            const strip = ensureTrackStrip(trackId);
            // setupTests' AudioWorkletNode port omits the browser close method used by strip disposal.
            if (strip.meterNode && typeof strip.meterNode.port.close !== 'function') {
                Object.defineProperty(strip.meterNode.port, 'close', { value: vi.fn(), configurable: true });
            }
        }
        source.connect.mockImplementation((gain: unknown) => connected.add(gain));
        source.disconnect.mockImplementation((gain: unknown) => connected.delete(gain));
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });
        initInputMonitoringProjectAccess();
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        refuseCommit = false;
        unsubscribe?.();
        configureInputMonitoringProjectAccess(null);
        stopInputMonitoring();
        removeTrackStrip('a');
        removeTrackStrip('b');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        restoreContextMethod('createMediaStreamSource', originalCreateMediaStreamSource);
        restoreContextMethod('createStereoPanner', originalCreateStereoPanner);
        if (originalMediaDevices) {
            Object.defineProperty(globalThis.navigator, 'mediaDevices', originalMediaDevices);
        } else {
            Reflect.deleteProperty(globalThis.navigator, 'mediaDevices');
        }
    });

    it.each([
        ['setter', (id: string) => setInputMonitoring(id, 'off')],
        ['toggle', (id: string) => toggleInputMonitoring(id)],
    ] as const)(
        'keeps an admitted On edge through refused %s Off and closes it only at committed Off',
        async (_, off) => {
            const aGain = gainNode('a');
            const bGain = gainNode('b');
            await Promise.all([startInputMonitoring('a', null), startInputMonitoring('b', null)]);
            await vi.waitFor(() => {
                expect(source.connect).toHaveBeenCalledWith(aGain);
                expect(source.connect).toHaveBeenCalledWith(bGain);
            });
            expect(committedMode('a')).toBe('on');
            expect(projectedMode('a')).toBe('on');
            expect(connected.has(aGain)).toBe(true);
            expect(connected.has(bGain)).toBe(true);
            expect(getUserMedia).toHaveBeenCalledOnce();
            expect(createMediaStreamSource).toHaveBeenCalledOnce();
            expect(createMediaStreamSource).toHaveBeenCalledWith(stream);

            const pendingOff = runWithAutomergeStorageTransaction(undefined, () => off('a'));
            if (pendingOff.status === 'threw') {
                throw pendingOff.error;
            }
            try {
                expect(committedMode('a')).toBe('on');
                expect(projectedMode('a')).toBe('off');
                expect(connected.has(aGain)).toBe(true);
                expect(connected.has(bGain)).toBe(true);
                expect(createMediaStreamSource).toHaveBeenCalledOnce();
                expect(getUserMedia).toHaveBeenCalledOnce();
                expect(mediaTrack.stop).not.toHaveBeenCalled();
                refuseCommit = true;
                expect(() => pendingOff.commit()).toThrow(refusal);
            } finally {
                refuseCommit = false;
                pendingOff.abort();
            }
            await vi.waitFor(() => expect(projectedMode('a')).toBe('on'));
            expect(committedMode('a')).toBe('on');
            expect(connected.has(aGain)).toBe(true);
            expect(connected.has(bGain)).toBe(true);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(getUserMedia).toHaveBeenCalledOnce();
            expect(createMediaStreamSource).toHaveBeenCalledOnce();

            const committedOff = runWithAutomergeStorageTransaction(undefined, () => off('a'));
            if (committedOff.status === 'threw') {
                throw committedOff.error;
            }
            committedOff.commit();
            expect(committedMode('a')).toBe('off');
            expect(connected.has(aGain)).toBe(false);
            expect(connected.has(bGain)).toBe(true);
            expect(source.disconnect).toHaveBeenCalledWith(aGain);
            expect(source.disconnect).not.toHaveBeenCalledWith(bGain);
            expect(getUserMedia).toHaveBeenCalledOnce();
            expect(createMediaStreamSource).toHaveBeenCalledOnce();
            expect(mediaTrack.stop).not.toHaveBeenCalled();

            const finalOff = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('b', 'off'));
            if (finalOff.status === 'threw') {
                throw finalOff.error;
            }
            finalOff.commit();
            expect(connected.size).toBe(0);
            expect(source.disconnect).toHaveBeenCalledWith(bGain);
            expect(mediaTrack.stop).toHaveBeenCalledOnce();
        }
    );

    it('does not admit a stored On row and retires a pending grant after Off commits', async () => {
        expect(committedMode('a')).toBe('on');
        expect(projectedMode('a')).toBe('on');
        expect(getUserMedia).not.toHaveBeenCalled();

        const pending = {
            grant(_value: typeof stream): void {
                throw new Error('Expected a pending capture request');
            },
        };
        const request = new Promise<typeof stream>((resolve) => {
            pending.grant = resolve;
        });
        getUserMedia.mockReturnValueOnce(request);
        const opening = startInputMonitoring('a', null);
        await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
        expect(source.connect).not.toHaveBeenCalled();
        expect(createMediaStreamSource).not.toHaveBeenCalled();

        const pendingOff = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('a', 'off'));
        if (pendingOff.status === 'threw') {
            throw pendingOff.error;
        }
        expect(committedMode('a')).toBe('on');
        expect(projectedMode('a')).toBe('off');
        expect(getUserMedia).toHaveBeenCalledOnce();
        pendingOff.commit();
        expect(committedMode('a')).toBe('off');
        pending.grant(stream);
        await opening;
        await vi.waitFor(() => expect(mediaTrack.stop).toHaveBeenCalledOnce());
        expect(source.connect).not.toHaveBeenCalled();
        expect(createMediaStreamSource).not.toHaveBeenCalled();
        expect(mediaTrack.stop).toHaveBeenCalledOnce();

        const freshTrack = { stop: vi.fn() };
        const freshStream = { getTracks: () => [freshTrack] };
        const freshSource = { connect: vi.fn(), disconnect: vi.fn() };
        getUserMedia.mockResolvedValueOnce(freshStream);
        createMediaStreamSource.mockReturnValueOnce(freshSource as unknown as MediaStreamAudioSourceNode);
        const committedOn = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('a', 'on'));
        if (committedOn.status === 'threw') {
            throw committedOn.error;
        }
        committedOn.commit();
        await vi.waitFor(() => expect(freshSource.connect).toHaveBeenCalledWith(gainNode('a')));
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(createMediaStreamSource).toHaveBeenCalledOnce();
        expect(createMediaStreamSource).toHaveBeenCalledWith(freshStream);
        expect(mediaTrack.stop).toHaveBeenCalledOnce();
        expect(freshTrack.stop).not.toHaveBeenCalled();
    });

    it('retains admitted On through optimistic Auto, then closes a disarmed Auto owner on commit', async () => {
        await startInputMonitoring('a', null);
        const aGain = gainNode('a');
        await vi.waitFor(() => expect(source.connect).toHaveBeenCalledWith(aGain));

        const pendingAuto = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('a', 'auto'));
        if (pendingAuto.status === 'threw') {
            throw pendingAuto.error;
        }
        expect(committedMode('a')).toBe('on');
        expect(projectedMode('a')).toBe('auto');
        expect(connected.has(aGain)).toBe(true);
        pendingAuto.commit();
        expect(committedMode('a')).toBe('auto');
        expect(connected.has(aGain)).toBe(false);
        expect(mediaTrack.stop).toHaveBeenCalledOnce();
    });

    it('closes a projected Off edge when no committed-project provider is installed', async () => {
        unsubscribe?.();
        unsubscribe = undefined;
        configureInputMonitoringProjectAccess(null);
        unsubscribe = syncAutoInputMonitoring();
        await startInputMonitoring('a', null);
        const aGain = gainNode('a');
        await vi.waitFor(() => expect(source.connect).toHaveBeenCalledWith(aGain));

        setInputMonitoring('a', 'off');
        expect(projectedMode('a')).toBe('off');
        expect(connected.has(aGain)).toBe(false);
        expect(mediaTrack.stop).toHaveBeenCalledOnce();
    });
});
