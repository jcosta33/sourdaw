/**
 * Bank staging: what the store is asked to hold before a batch maps.
 *
 * The engine refuses a device whose `sampleBankKey` holds no committed bank, so
 * the cases below pin the three-step stage, its ordering, and what a caller is
 * left believing after each way it can fail. Staging never refuses the batch of
 * its own accord — that is the whole reason a failure has to leave the memo
 * clean.
 *
 * The claim cases below pin the scoping rule that keeps a release from a live
 * `replaceTopology` batch from reclaiming a bank an offline bounce is still
 * mapping (#4203): a release consults every backend's claim, not only the one
 * replacing its topology.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommand, type AudioGraphDevice } from '../../../models/AudioGraphBackend';
import { type NativeSampleBank, type NativeSampleBankLease } from '../../../models/NativeSampleBank';
import { collectNativeSampleBankKeys } from '../collectNativeSampleBankKeys';
import { type NativeGraphTransport } from '../nativeGraphTransport';
import {
    claimedNativeSampleBankKeysByBackend,
    inFlightNativeSampleBankShipments,
    registeredNativeSampleBankKeys,
} from '../registeredNativeSampleBankKeys';
import { registerNativeSampleBanks } from '../registerNativeSampleBanks';
import { releaseNativeSampleBankClaims } from '../releaseNativeSampleBankClaims';

const LIVE_BACKEND_ID = 'live';

function device(overrides: Partial<AudioGraphDevice> = {}): AudioGraphDevice {
    return {
        id: 'device-a',
        name: 'Levain',
        type: 'levain',
        bypassed: false,
        parameterValues: {},
        ...overrides,
    };
}

function createStrip(trackId: string, devices: readonly AudioGraphDevice[]): AudioGraphCommand {
    return {
        kind: 'create-track-strip',
        trackId,
        name: trackId,
        state: { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
        devices,
        honorMuted: true,
        contributesAudio: true,
    };
}

function createBus(busId: string, devices: readonly AudioGraphDevice[]): AudioGraphCommand {
    return {
        kind: 'create-bus-strip',
        busId,
        name: busId,
        state: { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
        devices,
        honorMuted: true,
        contributesAudio: true,
    };
}

/** A single strip naming one bank key, the shape most cases below need. */
function commandsNaming(bankKey: string): readonly AudioGraphCommand[] {
    return [createStrip('audio-1', [device({ sampleBankKey: bankKey })])];
}

function bank(overrides: Partial<NativeSampleBank> = {}): NativeSampleBank {
    return {
        instrumentId: 'violin-1',
        numArticulations: 2,
        numMics: 1,
        zones: [],
        legatoTransitions: [],
        samples: [
            { sampleId: '0', sampleRate: 48_000, channels: 2, frameCount: 1, pcm: new Uint8Array([1, 2]) },
            { sampleId: '1', sampleRate: 48_000, channels: 1, frameCount: 1, pcm: new Uint8Array([3, 4]) },
        ],
        ...overrides,
    };
}

type RecordingTransport = {
    transport: NativeGraphTransport;
    calls: string[];
};

function recordingTransport(overrides: Partial<NativeGraphTransport> = {}): RecordingTransport {
    const calls: string[] = [];
    const transport: NativeGraphTransport = {
        beginLevainBank: ({ bankKey }) => {
            calls.push(`begin:${bankKey}`);
            return Promise.resolve(null);
        },
        registerLevainSample: ({ bankKey, sampleId }) => {
            calls.push(`sample:${bankKey}:${sampleId}`);
            return Promise.resolve(null);
        },
        commitLevainBank: ({ bankKey }) => {
            calls.push(`commit:${bankKey}`);
            return Promise.resolve(null);
        },
        releaseLevainBank: ({ bankKey }) => {
            calls.push(`release:${bankKey}`);
            return Promise.resolve(null);
        },
        registerTimelineSample: () => Promise.reject(new Error('unexpected register_timeline_sample')),
        renderGraphOffline: () => Promise.reject(new Error('unexpected render_graph_offline')),
        applyGraphCommands: () => Promise.reject(new Error('unexpected apply_graph_commands')),
        mapGraphBatch: () => Promise.reject(new Error('unexpected map_graph_batch')),
        ...overrides,
    };
    return { transport, calls };
}

function lease(release: () => void, overrides: Partial<NativeSampleBank> = {}): NativeSampleBankLease {
    return { bank: bank(overrides), release };
}

/** A step the case holds open, so a second caller arrives genuinely mid-flight. */
function deferred(): { promise: Promise<void>; settle: () => void } {
    let settle: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
        settle = resolve;
    });
    return { promise, settle };
}

describe('collectNativeSampleBankKeys', () => {
    it('reads every command kind that carries a device', () => {
        expect(
            collectNativeSampleBankKeys([
                createStrip('audio-1', [device({ sampleBankKey: 'levain:violin-1' })]),
                createBus('bus-1', [device({ id: 'device-b', sampleBankKey: 'levain:cello' })]),
                {
                    kind: 'insert-device',
                    trackId: 'audio-1',
                    device: device({ id: 'device-c', sampleBankKey: 'levain:flute' }),
                    index: 0,
                },
            ])
        ).toEqual(['levain:violin-1', 'levain:cello', 'levain:flute']);
    });

    it('names a shared instrument once, however many strips carry it', () => {
        // One staged bank per instrument is the point of keying by instrument:
        // the store holds one copy and the engine caches its conversions.
        expect(
            collectNativeSampleBankKeys([
                createStrip('audio-1', [device({ sampleBankKey: 'levain:violin-1' })]),
                createStrip('audio-2', [device({ id: 'device-b', sampleBankKey: 'levain:violin-1' })]),
            ])
        ).toEqual(['levain:violin-1']);
    });

    it('names nothing for devices built from their own record', () => {
        expect(collectNativeSampleBankKeys([createStrip('audio-1', [device({ type: 'fermenter' })])])).toEqual([]);
    });
});

describe('registerNativeSampleBanks', () => {
    beforeEach(() => {
        registeredNativeSampleBankKeys.clear();
        inFlightNativeSampleBankShipments.clear();
        claimedNativeSampleBankKeysByBackend.clear();
    });

    const commands = [createStrip('audio-1', [device({ sampleBankKey: 'levain:violin-1' })])];

    it('stages a bank as begin, then every sample, then commit', async () => {
        const { transport, calls } = recordingTransport();

        const committed = await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () => Promise.resolve(lease(vi.fn())),
            backendId: LIVE_BACKEND_ID,
        });

        expect(calls).toEqual([
            'begin:levain:violin-1',
            'sample:levain:violin-1:0',
            'sample:levain:violin-1:1',
            'commit:levain:violin-1',
        ]);
        expect(committed).toEqual(['levain:violin-1']);
    });

    it('commits the zone layout alone, without the fields the store would refuse', async () => {
        const commitLevainBank = vi.fn().mockResolvedValue(null);
        const { transport } = recordingTransport({ commitLevainBank });

        await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () =>
                Promise.resolve(
                    lease(vi.fn(), {
                        zones: [],
                        legatoTransitions: [],
                        numArticulations: 5,
                        numMics: 3,
                    })
                ),
            backendId: LIVE_BACKEND_ID,
        });

        // `LevainBankLayout` is deserialized with `deny_unknown_fields`, so
        // `instrumentId` or `samples` riding along would refuse the commit.
        expect(commitLevainBank).toHaveBeenCalledWith({
            bankKey: 'levain:violin-1',
            layout: { numArticulations: 5, numMics: 3, zones: [], legatoTransitions: [] },
        });
    });

    it('releases the renderer lease once the bytes have crossed', async () => {
        const release = vi.fn();
        const { transport } = recordingTransport();

        await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () => Promise.resolve(lease(release)),
            backendId: LIVE_BACKEND_ID,
        });

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('stages a key it already believes committed no second time', async () => {
        const { transport, calls } = recordingTransport();
        const acquire = vi.fn(() => Promise.resolve(lease(vi.fn())));

        await registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID });
        const second = await registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID });

        expect(acquire).toHaveBeenCalledTimes(1);
        expect(calls.filter((call) => call.startsWith('begin:'))).toHaveLength(1);
        expect(second).toEqual([]);
    });

    it('stages nothing for a key no module owns', async () => {
        const { transport, calls } = recordingTransport();

        const committed = await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () => Promise.resolve(null),
            backendId: LIVE_BACKEND_ID,
        });

        expect(calls).toEqual([]);
        expect(committed).toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(false);
    });

    it('leaves a key whose decode failed unregistered, and retries it next batch', async () => {
        const release = vi.fn();
        const { transport } = recordingTransport();
        const acquire = vi
            .fn<(bankKey: string) => Promise<NativeSampleBankLease | null>>()
            .mockRejectedValueOnce(new Error('manifest 404'))
            .mockResolvedValueOnce(lease(release));

        // Never a throw. The batch still goes out, and `refuse_or_degrade`
        // decides what the missing bank costs: the gesture declines native
        // carriage on an audible strip and the device is dropped on a silent
        // one. Throwing here would only take the batch's other strips down too.
        await expect(
            registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID })
        ).resolves.toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(false);

        await expect(
            registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID })
        ).resolves.toEqual(['levain:violin-1']);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('leaves a key whose commit failed unregistered, and still releases the lease', async () => {
        const release = vi.fn();
        const { transport } = recordingTransport({
            commitLevainBank: () => Promise.reject(new Error('bank store refused the layout')),
        });

        const committed = await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () => Promise.resolve(lease(release)),
            backendId: LIVE_BACKEND_ID,
        });

        expect(committed).toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(false);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases a bank a topology replacement no longer names', async () => {
        const { transport, calls } = recordingTransport();
        registeredNativeSampleBankKeys.add('levain:trumpet');

        await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        // A replacement states the whole graph, so an unnamed bank is an
        // instrument nothing plays any more.
        expect(calls).toContain('release:levain:trumpet');
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(false);
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(true);
    });

    it('releases nothing on an incremental batch', async () => {
        const { transport, calls } = recordingTransport();
        registeredNativeSampleBankKeys.add('levain:trumpet');

        await registerNativeSampleBanks({
            transport,
            commands,
            acquire: () => Promise.resolve(lease(vi.fn())),
            backendId: LIVE_BACKEND_ID,
        });

        // An incremental batch says nothing about the strips it did not mention.
        expect(calls.filter((call) => call.startsWith('release:'))).toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(true);
    });

    // The live backend and the offline render stage into one process-wide store
    // from queues that do not know about each other, and the committed-key memo
    // only answers after the fact. A second `begin_levain_bank` landing mid
    // shipment replaces the bank the first one was filling, so the commit that
    // follows describes material the store no longer holds.
    it('waits on a shipment already in flight instead of staging the key twice', async () => {
        const begun = deferred();
        const beginLevainBank = vi.fn(() => begun.promise.then(() => null));
        const { transport, calls } = recordingTransport({ beginLevainBank });
        const acquire = vi.fn(() => Promise.resolve(lease(vi.fn())));

        const first = registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID });
        const second = registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID });
        begun.settle();

        // The key was staged by the first call, so only it takes credit — the
        // second learns its own staging did nothing.
        await expect(first).resolves.toEqual(['levain:violin-1']);
        await expect(second).resolves.toEqual([]);
        expect(beginLevainBank).toHaveBeenCalledTimes(1);
        expect(calls.filter((call) => call.startsWith('sample:'))).toEqual([
            'sample:levain:violin-1:0',
            'sample:levain:violin-1:1',
        ]);
        expect(calls.filter((call) => call.startsWith('commit:'))).toEqual(['commit:levain:violin-1']);
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(true);
        expect(inFlightNativeSampleBankShipments.size).toBe(0);
    });

    it('leaves a key whose in-flight shipment failed stageable by a later call', async () => {
        const beginLevainBank = vi.fn().mockResolvedValue(null);
        const commitLevainBank = vi
            .fn()
            .mockRejectedValueOnce(new Error('bank store refused the layout'))
            .mockResolvedValue(null);
        const { transport } = recordingTransport({ beginLevainBank, commitLevainBank });
        const acquire = vi.fn(() => Promise.resolve(lease(vi.fn())));

        const first = registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID });
        const second = registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID });

        // A waiter inherits the failure as an uncommitted key, not as a throw:
        // staging never refuses the batch of its own accord.
        await expect(first).resolves.toEqual([]);
        await expect(second).resolves.toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(false);
        expect(inFlightNativeSampleBankShipments.size).toBe(0);

        await expect(
            registerNativeSampleBanks({ transport, commands, acquire, backendId: LIVE_BACKEND_ID })
        ).resolves.toEqual(['levain:violin-1']);
        expect(beginLevainBank).toHaveBeenCalledTimes(2);
    });
});

describe('registerNativeSampleBanks — claims scoped by backend (#4203)', () => {
    beforeEach(() => {
        registeredNativeSampleBankKeys.clear();
        inFlightNativeSampleBankShipments.clear();
        claimedNativeSampleBankKeysByBackend.clear();
    });

    it('never releases a bank an offline backend still claims, on a live replaceTopology batch that does not name it', async () => {
        const { transport, calls } = recordingTransport();

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:trumpet'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            backendId: 'off-1',
        });

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:violin'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        expect(calls.filter((call) => call.startsWith('release:'))).not.toContain('release:levain:trumpet');
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(true);
    });

    it('releases a bank once the backend that alone claimed it drops its claim', async () => {
        const { transport, calls } = recordingTransport();

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:trumpet'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            backendId: 'off-1',
        });
        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:violin'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        releaseNativeSampleBankClaims('off-1');

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:violin'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        expect(calls).toContain('release:levain:trumpet');
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(false);
    });

    it('never releases a key with a shipment in flight, even when no backend claims it', async () => {
        const { transport, calls } = recordingTransport();
        registeredNativeSampleBankKeys.add('levain:trumpet');
        // Never settles inside this case: the release pass must see it in
        // flight without waiting for it.
        inFlightNativeSampleBankShipments.set('levain:trumpet', new Promise<void>(() => undefined));

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:violin'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        expect(calls.filter((call) => call.startsWith('release:'))).toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(true);
    });

    it('never releases a bank already committed while a sibling in the same batch is still shipping', async () => {
        // The offline batch names two banks. Trumpet stages and commits
        // through ordinary microtask ticks; violin's `begin_levain_bank` is
        // held open on a deferred that this case controls, so the offline
        // call's own loop cannot reach its post-loop code — and with the
        // claim write sited after that loop, its backend would still be
        // unclaimed for a bank it already shipped. A foreign backend's
        // `replaceTopology` naming nothing races in once trumpet is
        // genuinely committed (observed, not counted in ticks) but before
        // offline's own batch has finished: it must find trumpet claimed by
        // offline's still-in-flight batch, not free to reclaim.
        const violinBegin = deferred();
        const beginLevainBank = vi.fn(({ bankKey }: { bankKey: string }) =>
            bankKey === 'levain:violin' ? violinBegin.promise.then(() => null) : Promise.resolve(null)
        );
        const { transport, calls } = recordingTransport({ beginLevainBank });

        const offline = registerNativeSampleBanks({
            transport,
            commands: [
                createStrip('audio-1', [
                    device({ id: 'device-a', sampleBankKey: 'levain:trumpet' }),
                    device({ id: 'device-b', sampleBankKey: 'levain:violin' }),
                ]),
            ],
            acquire: () => Promise.resolve(lease(vi.fn())),
            backendId: 'off-1',
        });

        await vi.waitFor(() => {
            expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(true);
        });

        // Trumpet is committed; violin's begin is still held open, so
        // offline's own batch has not reached its post-loop code. A foreign
        // backend's replaceTopology naming nothing must still find trumpet
        // spoken for.
        await registerNativeSampleBanks({
            transport,
            commands: [],
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: 'foreign',
        });

        expect(calls.filter((call) => call.startsWith('release:'))).not.toContain('release:levain:trumpet');
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(true);

        violinBegin.settle();
        await offline;

        expect(registeredNativeSampleBankKeys.has('levain:violin')).toBe(true);
    });

    it("unions a later non-replace batch onto the same backend's claim rather than replacing it", async () => {
        const { transport, calls } = recordingTransport();

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:trumpet'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });
        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:violin'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            backendId: LIVE_BACKEND_ID,
        });
        // A foreign backend's replaceTopology naming neither must not read
        // this backend's claim as having dropped trumpet just because a later
        // incremental batch on the same backend named only violin.
        await registerNativeSampleBanks({
            transport,
            commands: [],
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: 'foreign',
        });

        expect(calls.filter((call) => call.startsWith('release:'))).toEqual([]);
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(true);
        expect(registeredNativeSampleBankKeys.has('levain:violin')).toBe(true);
    });

    it('replaces its claim on replaceTopology rather than unioning it, so a dropped device releases', async () => {
        const { transport, calls } = recordingTransport();

        await registerNativeSampleBanks({
            transport,
            commands: [
                createStrip('audio-1', [
                    device({ id: 'device-a', sampleBankKey: 'levain:violin' }),
                    device({ id: 'device-b', sampleBankKey: 'levain:trumpet' }),
                ]),
            ],
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        await registerNativeSampleBanks({
            transport,
            commands: commandsNaming('levain:violin'),
            acquire: () => Promise.resolve(lease(vi.fn())),
            replaceTopology: true,
            backendId: LIVE_BACKEND_ID,
        });

        expect(calls).toContain('release:levain:trumpet');
        expect(registeredNativeSampleBankKeys.has('levain:trumpet')).toBe(false);
        expect(registeredNativeSampleBankKeys.has('levain:violin')).toBe(true);
    });
});
