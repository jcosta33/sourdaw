import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphBackend, type AudioGraphApplyResult } from '../../../models/AudioGraphBackend';
import { stoppedEngineTransportPosition } from '../../../models/EngineTransportPosition';
import { getEngineTransportPosition } from '../../../repositories/engineTransport/getEngineTransportPosition';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { sendNativeGrinderNeuralPatch } from '../sendNativeGrinderNeuralPatch';

vi.mock('../../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: vi.fn(),
}));
const receipt = {
    deviceId: 'd',
    trackId: 't',
    engineId: '9007199254740993',
    targetGeneration: '42',
    requestId: 'request',
    contentHash: 'a'.repeat(64),
};
const admitted: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    admittedBatch: 7,
    engineId: receipt.engineId,
    grinderModels: [receipt],
    reports: [],
};
function backend(): AudioGraphBackend {
    let disposed = false;
    return {
        backendId: 'native-live',
        get disposed() {
            return disposed;
        },
        apply: vi.fn(async () => admitted),
        dispose: vi.fn(() => {
            disposed = true;
        }),
    };
}

describe('sendNativeGrinderNeuralPatch actual receipt drain', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
        trackStore.set(null);
        vi.restoreAllMocks();
    });

    it('requires matching engine and target identity even when a successor reaches the same fence', async () => {
        const current = backend();
        nativeLiveGraphSession.backend = current;
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            running: true,
            engineId: '9007199254740994',
            batchesApplied: 7,
            grinderModels: [receipt],
        });
        await expect(
            sendNativeGrinderNeuralPatch({ kind: 'drain', backend: current, result: admitted })
        ).rejects.toThrow(/engine/);
    });

    it('waits below the admitted fence and only completes on actual matching model readback', async () => {
        const current = backend();
        nativeLiveGraphSession.backend = current;
        let firstRead!: () => void;
        const observed = new Promise<void>((resolve) => {
            firstRead = resolve;
        });
        let release!: (value: Awaited<ReturnType<typeof getEngineTransportPosition>>) => void;
        const later = new Promise<Awaited<ReturnType<typeof getEngineTransportPosition>>>((resolve) => {
            release = resolve;
        });
        vi.mocked(getEngineTransportPosition)
            .mockImplementationOnce(async () => {
                firstRead();
                return {
                    ...stoppedEngineTransportPosition,
                    running: true,
                    engineId: receipt.engineId,
                    batchesApplied: 6,
                    grinderModels: [],
                };
            })
            .mockImplementation(() => later);
        let completed = false;
        const waiting = sendNativeGrinderNeuralPatch({ kind: 'drain', backend: current, result: admitted }).then(() => {
            completed = true;
        });
        await observed;
        expect(completed).toBe(false);
        release({
            ...stoppedEngineTransportPosition,
            running: true,
            engineId: receipt.engineId,
            batchesApplied: 7,
            grinderModels: [receipt],
        });
        await waiting;
        expect(completed).toBe(true);
    });

    it('refuses a disposed/replaced backend and missing or unsafe native receipts', async () => {
        const old = backend();
        nativeLiveGraphSession.backend = backend();
        await expect(sendNativeGrinderNeuralPatch({ kind: 'drain', backend: old, result: admitted })).rejects.toThrow(
            /session/
        );
        nativeLiveGraphSession.backend = old;
        await expect(
            sendNativeGrinderNeuralPatch({
                kind: 'drain',
                backend: old,
                result: { ...admitted, admittedBatch: Number.MAX_SAFE_INTEGER + 1 },
            })
        ).rejects.toThrow(/fence/);
    });

    it('refuses a disposed backend before entering native readback', async () => {
        const current = backend();
        nativeLiveGraphSession.backend = current;
        current.dispose();
        vi.mocked(getEngineTransportPosition).mockClear();

        await expect(
            sendNativeGrinderNeuralPatch({ kind: 'drain', backend: current, result: admitted })
        ).rejects.toThrow('Native NAM backend disposed or lifetime readback unavailable');

        expect(getEngineTransportPosition).not.toHaveBeenCalled();
        expect(current.apply).not.toHaveBeenCalled();
    });

    it('refuses a stale session witness before entering native readback', async () => {
        const current = backend();
        nativeLiveGraphSession.backend = current;
        vi.mocked(getEngineTransportPosition).mockClear();

        await expect(
            sendNativeGrinderNeuralPatch({
                kind: 'drain',
                backend: current,
                result: admitted,
                session: { backend: current, epoch: nativeLiveGraphSession.rearmEpoch + 1 },
            })
        ).rejects.toThrow('Native NAM session changed during drain');

        expect(getEngineTransportPosition).not.toHaveBeenCalled();
        expect(current.apply).not.toHaveBeenCalled();
    });

    it('requires explicit lifetime readback before entering native readback', async () => {
        const current: AudioGraphBackend = {
            backendId: 'native-live',
            apply: vi.fn(async () => admitted),
            dispose: vi.fn(),
        };
        nativeLiveGraphSession.backend = current;
        vi.mocked(getEngineTransportPosition).mockClear();

        await expect(
            sendNativeGrinderNeuralPatch({ kind: 'drain', backend: current, result: admitted })
        ).rejects.toThrow('Native NAM backend disposed or lifetime readback unavailable');

        expect(getEngineTransportPosition).not.toHaveBeenCalled();
        expect(current.apply).not.toHaveBeenCalled();
    });

    it.each(['disposal', 'epoch', 'backend'] as const)(
        'refuses %s after native readback was entered even with a matching receipt',
        async (change) => {
            const current = backend();
            nativeLiveGraphSession.backend = current;
            const epoch = nativeLiveGraphSession.rearmEpoch;
            let entered!: () => void;
            const observed = new Promise<void>((resolve) => {
                entered = resolve;
            });
            let release!: (position: Awaited<ReturnType<typeof getEngineTransportPosition>>) => void;
            const readback = new Promise<Awaited<ReturnType<typeof getEngineTransportPosition>>>((resolve) => {
                release = resolve;
            });
            vi.mocked(getEngineTransportPosition).mockImplementation(() => {
                entered();
                return readback;
            });
            const pending = sendNativeGrinderNeuralPatch({ kind: 'drain', backend: current, result: admitted });
            let reason = 'Native NAM session changed during drain';
            if (change === 'disposal') {
                reason = 'Native NAM backend disposed during drain';
            }
            const rejected = expect(pending).rejects.toThrow(reason);
            try {
                await observed;
                if (change === 'disposal') {
                    current.dispose();
                } else if (change === 'epoch') {
                    nativeLiveGraphSession.rearmEpoch += 1;
                } else {
                    nativeLiveGraphSession.backend = backend();
                }
                release({
                    ...stoppedEngineTransportPosition,
                    running: true,
                    engineId: receipt.engineId,
                    batchesApplied: 7,
                    grinderModels: [receipt],
                });
                await rejected;
                expect(current.apply).not.toHaveBeenCalled();
            } finally {
                nativeLiveGraphSession.rearmEpoch = epoch;
            }
        }
    );
});

function holdingGrinder(): Track {
    return {
        id: 't',
        name: 'Lead',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [{ id: 'd', name: 'Grinder', type: 'grinder', bypassed: false, parameterValues: {} }],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'a',
        alternatives: [{ id: 'a', name: 'Main', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

describe('native Grinder queued request ownership', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
        trackStore.set(null);
        vi.restoreAllMocks();
    });

    it('lets an actual clear supersede a delayed model admission without completing the stale load', async () => {
        trackStore.set({ tracks: [holdingGrinder()], selectedTrackId: null, ghostClips: [] });
        let firstApply!: () => void;
        const observed = new Promise<void>((resolve) => {
            firstApply = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let latest = receipt;
        let calls = 0;
        const current: AudioGraphBackend = {
            backendId: 'native/live',
            disposed: false,
            dispose: vi.fn(),
            apply: async (batch) => {
                const command = batch.commands[0];
                if (command?.kind !== 'set-grinder-model') {
                    throw new Error('unexpected test operation');
                }
                calls += 1;
                if (calls === 1) {
                    firstApply();
                    await gate;
                }
                let contentHash: string;
                if (command.modelJson === null) {
                    contentHash = '0'.repeat(64);
                } else {
                    contentHash = createHash('sha256').update(command.modelJson).digest('hex');
                }
                latest = {
                    ...receipt,
                    requestId: command.requestId,
                    contentHash,
                };
                return { ...admitted, grinderModels: [latest] };
            },
        };
        nativeLiveGraphSession.backend = current;
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => ({
            ...stoppedEngineTransportPosition,
            running: true,
            engineId: latest.engineId,
            batchesApplied: 7,
            grinderModels: [latest],
        }));
        const loading = sendNativeGrinderNeuralPatch({
            kind: 'write',
            trackId: 't',
            deviceId: 'd',
            modelJson: '{"architecture":"Linear","config":{"receptive_field":1,"bias":false},"weights":[0.5]}',
            values: { neuralModelMode: 1 },
        });
        const refused = expect(loading).rejects.toThrow(/superseded/);
        await observed;
        const clearing = sendNativeGrinderNeuralPatch({
            kind: 'write',
            trackId: 't',
            deviceId: 'd',
            modelJson: null,
            values: { neuralModelMode: 0, neuralModelSlot: 1 },
        });
        release();
        await refused;
        await clearing;
        expect(calls).toBe(2);
        expect(latest.contentHash).toBe('0'.repeat(64));
    });

    it('refuses completion after native handle disposal even if the same engine reaches the fence', async () => {
        let disposed = false;
        const current: AudioGraphBackend = {
            backendId: 'native/live',
            get disposed() {
                return disposed;
            },
            apply: async () => admitted,
            dispose: () => {
                disposed = true;
            },
        };
        nativeLiveGraphSession.backend = current;
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => {
            current.dispose();
            return {
                ...stoppedEngineTransportPosition,
                running: true,
                engineId: receipt.engineId,
                batchesApplied: 7,
                grinderModels: [receipt],
            };
        });
        await expect(
            sendNativeGrinderNeuralPatch({ kind: 'drain', backend: current, result: admitted })
        ).rejects.toThrow(/disposed/);
    });
});
