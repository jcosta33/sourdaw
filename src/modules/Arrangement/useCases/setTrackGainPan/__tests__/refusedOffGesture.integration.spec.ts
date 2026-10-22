import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initInputMonitoringProjectAccess } from '#/app/initInputMonitoringProjectAccess';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, toggleInputMonitoring } from '#/modules/Arrangement/useCases';
import { inputMonitoringSession } from '#/modules/AudioEngine/repositories/audioRecorder/inputMonitoringSession';
import {
    configureInputMonitoringProjectAccess,
    startInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';
import { createCrdtDoc, getCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { setInputMonitoring } from '../setInputMonitoring';

const engine = vi.hoisted(() => ({
    createMediaStreamSource: vi.fn(),
    ensureTrackStrip: vi.fn(),
}));
const getUserMedia = vi.fn();

vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { createMediaStreamSource: engine.createMediaStreamSource },
        ensureTrackStrip: engine.ensureTrackStrip,
        getRuntimeGraphRevision: () => 0,
    },
}));

describe('committed input monitoring through Off gestures', () => {
    const originalMediaDevices = globalThis.navigator.mediaDevices;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const connected = new Set<unknown>();
    const mediaTrack = { stop: vi.fn() };
    const stream = { getTracks: () => [mediaTrack] };
    const gains = new Map([
        ['a', { id: 'a-gain' }],
        ['b', { id: 'b-gain' }],
    ]);
    const refusal = new Error('Off write refused at commit');
    let refuseCommit = false;
    let unsubscribe: (() => void) | undefined;

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
        engine.createMediaStreamSource.mockReturnValue(source);
        engine.ensureTrackStrip.mockImplementation((trackId: string) => ({ gainNode: gains.get(trackId) }));
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
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it.each([
        ['setter', (id: string) => setInputMonitoring(id, 'off')],
        ['toggle', (id: string) => toggleInputMonitoring(id)],
    ] as const)(
        'keeps an admitted On edge through refused %s Off and closes it only at committed Off',
        async (_, off) => {
            await Promise.all([startInputMonitoring('a', null), startInputMonitoring('b', null)]);
            await vi.waitFor(() => {
                expect(source.connect).toHaveBeenCalledWith(gains.get('a'));
                expect(source.connect).toHaveBeenCalledWith(gains.get('b'));
            });
            expect(committedMode('a')).toBe('on');
            expect(projectedMode('a')).toBe('on');
            expect(inputMonitoringSession.trackKeys.has('a')).toBe(true);
            expect(inputMonitoringSession.trackKeys.has('b')).toBe(true);
            const capture = inputMonitoringSession.captures.get(null);

            const pendingOff = runWithAutomergeStorageTransaction(undefined, () => off('a'));
            if (pendingOff.status === 'threw') {
                throw pendingOff.error;
            }
            try {
                expect(committedMode('a')).toBe('on');
                expect(projectedMode('a')).toBe('off');
                expect(connected.has(gains.get('a'))).toBe(true);
                expect(inputMonitoringSession.trackKeys.has('a')).toBe(true);
                expect(inputMonitoringSession.captures.get(null)).toBe(capture);
                expect(mediaTrack.stop).not.toHaveBeenCalled();
                refuseCommit = true;
                expect(() => pendingOff.commit()).toThrow(refusal);
            } finally {
                refuseCommit = false;
                pendingOff.abort();
            }
            await vi.waitFor(() => expect(projectedMode('a')).toBe('on'));
            expect(committedMode('a')).toBe('on');
            expect(connected.has(gains.get('a'))).toBe(true);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(getUserMedia).toHaveBeenCalledOnce();

            const committedOff = runWithAutomergeStorageTransaction(undefined, () => off('a'));
            if (committedOff.status === 'threw') {
                throw committedOff.error;
            }
            committedOff.commit();
            expect(committedMode('a')).toBe('off');
            expect(connected.has(gains.get('a'))).toBe(false);
            expect(connected.has(gains.get('b'))).toBe(true);
            expect(inputMonitoringSession.captures.get(null)).toBe(capture);
            expect(mediaTrack.stop).not.toHaveBeenCalled();

            const finalOff = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('b', 'off'));
            if (finalOff.status === 'threw') {
                throw finalOff.error;
            }
            finalOff.commit();
            expect(connected.size).toBe(0);
            expect(inputMonitoringSession.captures.has(null)).toBe(false);
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

        const pendingOff = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('a', 'off'));
        if (pendingOff.status === 'threw') {
            throw pendingOff.error;
        }
        expect(committedMode('a')).toBe('on');
        expect(inputMonitoringSession.trackKeys.has('a')).toBe(true);
        pendingOff.commit();
        expect(committedMode('a')).toBe('off');
        pending.grant(stream);
        await opening;
        await vi.waitFor(() => expect(inputMonitoringSession.pendingRequests.size).toBe(0));
        expect(source.connect).not.toHaveBeenCalled();
        expect(inputMonitoringSession.trackKeys.has('a')).toBe(false);
        expect(mediaTrack.stop).toHaveBeenCalledOnce();
    });

    it('retains admitted On through optimistic Auto, then closes a disarmed Auto owner on commit', async () => {
        await startInputMonitoring('a', null);
        await vi.waitFor(() => expect(source.connect).toHaveBeenCalledWith(gains.get('a')));

        const pendingAuto = runWithAutomergeStorageTransaction(undefined, () => setInputMonitoring('a', 'auto'));
        if (pendingAuto.status === 'threw') {
            throw pendingAuto.error;
        }
        expect(committedMode('a')).toBe('on');
        expect(projectedMode('a')).toBe('auto');
        expect(connected.has(gains.get('a'))).toBe(true);
        pendingAuto.commit();
        expect(committedMode('a')).toBe('auto');
        expect(connected.has(gains.get('a'))).toBe(false);
        expect(mediaTrack.stop).toHaveBeenCalledOnce();
    });

    it('closes a projected Off edge when no committed-project provider is installed', async () => {
        unsubscribe?.();
        unsubscribe = undefined;
        configureInputMonitoringProjectAccess(null);
        unsubscribe = syncAutoInputMonitoring();
        await startInputMonitoring('a', null);
        await vi.waitFor(() => expect(source.connect).toHaveBeenCalledWith(gains.get('a')));

        setInputMonitoring('a', 'off');
        expect(projectedMode('a')).toBe('off');
        expect(connected.has(gains.get('a'))).toBe(false);
        expect(mediaTrack.stop).toHaveBeenCalledOnce();
    });
});
