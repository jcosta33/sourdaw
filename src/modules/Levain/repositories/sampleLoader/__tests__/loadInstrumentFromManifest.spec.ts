import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { decodedBankResource } from '../decodedBankResource';
import { fetchAndDecode } from '../fetchAndDecode';
import { loadInstrumentFromManifest } from '../loadInstrumentFromManifest';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../fetchAndDecode', () => {
    const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 2);
    return {
        fetchAndDecode: vi.fn().mockResolvedValue({
            data: new Float32Array(buffer),
            frameCount: 1,
            channels: 2,
            sampleRate: 44100,
        }),
    };
});

const MANIFEST = {
    version: 1,
    instrumentId: 'violin-1',
    sampleRate: 44100,
    micPositions: ['close'],
    articulations: [
        {
            type: 'sustain',
            id: 0,
            zones: [
                {
                    file: 'a.wav',
                    rootNote: 60,
                    loKey: 0,
                    hiKey: 127,
                    loVel: 0,
                    hiVel: 127,
                    rrPos: 0,
                    rrLen: 1,
                    micId: 0,
                    isRelease: false,
                    loopMode: 'none',
                    loopStart: 0,
                    loopEnd: 0,
                    loopCrossfade: 0,
                    gainDb: 0,
                    attack: 0,
                    decay: 0,
                    sustain: 1,
                    release: 0,
                },
            ],
        },
    ],
};

function mockFetchOk(): void {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MANIFEST),
        })
    );
}

type FakePort = MessagePort & {
    postMessage: ReturnType<typeof vi.fn>;
    emit: (message: unknown) => void;
};

type MakePortOptions = {
    uploadRequired?: boolean;
    autoComplete?: boolean;
    commitError?: string;
    /**
     * Model the processor's own commit timing: `buildZoneMap` clears the
     * pending token synchronously (as `_completeSampleBankLoad` does,
     * levainProcessor.ts ~:285-291) but the test emits the terminal
     * `sampleBankLoaded` itself, later — so a race between an abort and that
     * still-unset reply can be driven deterministically instead of via timers.
     */
    deferCommit?: boolean;
};

/**
 * A fake worklet port modelled on `levainProcessor.ts`'s own token bookkeeping
 * (~:178, ~:285-343, ~:513-517): it tracks the one load token it considers
 * pending and only answers a matched `abortSampleBank` — exactly like the
 * real processor's `abortSampleBank` case, which is a no-op once
 * `_bankLoadToken` no longer matches (already committed, or a different
 * load).
 */
function makePort(options: MakePortOptions = {}): FakePort {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    let pendingToken: number | null = null;
    function emit(message: unknown): void {
        const event = { data: message } as MessageEvent<unknown>;
        for (const listener of listeners) {
            listener(event);
        }
    }
    const postMessage = vi.fn((message: unknown) => {
        if (!isRecord(message) || typeof message.loadToken !== 'number') {
            return;
        }
        if (message.type === 'beginSampleBank') {
            pendingToken = message.loadToken;
            queueMicrotask(() => {
                emit({
                    type: 'sampleBankUploadDecision',
                    loadToken: message.loadToken,
                    uploadRequired: options.uploadRequired ?? true,
                });
            });
            return;
        }
        if (message.type === 'buildZoneMap') {
            if (options.autoComplete === false) {
                // Models a commit still in flight (e.g. a shared-bank
                // follower awaiting its owner) — the token stays pending.
                return;
            }
            // The real processor clears its token synchronously on commit,
            // before the reply is even queued.
            pendingToken = null;
            if (options.deferCommit) {
                return;
            }
            queueMicrotask(() => {
                if (options.commitError) {
                    emit({ type: 'sampleBankError', loadToken: message.loadToken, message: options.commitError });
                    return;
                }
                emit({ type: 'sampleBankLoaded', loadToken: message.loadToken });
            });
            return;
        }
        if (message.type === 'abortSampleBank') {
            if (message.loadToken !== pendingToken) {
                // Matches `msg.loadToken === this._bankLoadToken` failing on
                // the real processor: already committed, or a stale token.
                return;
            }
            pendingToken = null;
            queueMicrotask(() => {
                emit({
                    type: 'sampleBankError',
                    loadToken: message.loadToken,
                    message: 'Levain sample bank load was aborted',
                });
            });
        }
    });
    return {
        postMessage,
        emit,
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
            if (typeof listener === 'function') {
                listeners.add(listener);
            }
        },
        removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
            if (typeof listener === 'function') {
                listeners.delete(listener);
            }
        },
    } as unknown as FakePort;
}

function postedTypes(port: { postMessage: ReturnType<typeof vi.fn> }): string[] {
    return port.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getPostedSampleData(call: unknown[] | undefined): Float32Array {
    const message: unknown = call?.[0];
    if (!isRecord(message) || message.type !== 'addSample' || !(message.data instanceof Float32Array)) {
        throw new Error('Expected an addSample message with Float32Array data');
    }
    return message.data;
}

describe('loadInstrumentFromManifest', () => {
    beforeEach(() => {
        decodedBankResource.clear();
        mockFetchOk();
    });

    afterEach(() => {
        decodedBankResource.clear();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('builds the zone map for a normal (un-aborted) load', async () => {
        const port = makePort();

        await loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
        });

        expect(decodedBankResource.getDiagnostics().activeLeases).toBe(0);
        const types = postedTypes(port);
        expect(types).toContain('beginSampleBank');
        expect(types).toContain('addSample');
        expect(types).toContain('buildZoneMap');
        expect(types.indexOf('beginSampleBank')).toBeLessThan(types.indexOf('addSample'));
        const beginCall = port.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'beginSampleBank';
        });
        const addSampleCall = port.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'addSample';
        });
        const beginMessage: unknown = beginCall?.[0];
        const addSampleMessage: unknown = addSampleCall?.[0];
        if (!isRecord(beginMessage) || !isRecord(addSampleMessage)) {
            throw new Error('Expected beginSampleBank and addSample messages');
        }
        expect(addSampleCall).toHaveLength(1);
        expect(beginMessage.instrumentId).toBe('violin-1');
        expect(addSampleMessage.loadToken).toBe(beginMessage.loadToken);
        const zoneAndBuildMessages = port.postMessage.mock.calls
            .map(([message]) => message as { type: string; loadToken?: number })
            .filter((message) => message.type === 'addZone' || message.type === 'buildZoneMap');
        expect(zoneAndBuildMessages.every((message) => message.loadToken === beginMessage.loadToken)).toBe(true);
    });

    it('resolves the validated sample-end loop sentinel against decoded frame count', async () => {
        const port = makePort();
        const manifest = {
            ...MANIFEST,
            articulations: [
                {
                    ...MANIFEST.articulations[0],
                    zones: [{ ...MANIFEST.articulations[0]!.zones[0], loopMode: 'forward' }],
                },
            ],
        };
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve(manifest),
            })
        );

        await loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
        });

        let addZone: unknown;
        for (const call of port.postMessage.mock.calls) {
            const message: unknown = call[0];
            if (isRecord(message) && message.type === 'addZone') {
                addZone = message;
                break;
            }
        }
        expect(addZone).toMatchObject({ loopMode: 'forward', loopStart: 0, loopEnd: 1, loopCrossfade: 0 });
    });

    it('registers each recorded legato transition against its own sample id', async () => {
        const port = makePort();
        const manifest = {
            ...MANIFEST,
            legatoTransitions: [
                {
                    file: 'slur-up-2.wav',
                    interval: 2,
                    transitionType: 'slurred',
                    dynamic: 'mf',
                    crossfadeOutMs: 80,
                },
            ],
        };
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve(manifest),
            })
        );

        await loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
        });

        const messages = port.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
        const uploaded = messages.filter((message) => message.type === 'addSample');
        // The transition's PCM is a second file the bank would otherwise never
        // fetch: the zone list only names `a.wav`.
        expect(uploaded).toHaveLength(2);
        const transitionSampleId = uploaded[1]!.sampleId;

        const registered = messages.filter((message) => message.type === 'addLegatoTransition');
        expect(registered).toHaveLength(1);
        expect(registered[0]).toMatchObject({
            sampleId: transitionSampleId,
            interval: 2,
            transitionType: 'slurred',
            dynamic: 'mf',
            crossfadeOutMs: 80,
        });
        expect(registered[0]).not.toHaveProperty('crossfadeInMs');
    });

    it('posts no legato transition for a bank that authors none', async () => {
        const port = makePort();

        await loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
        });

        expect(postedTypes(port)).not.toContain('addLegatoTransition');
    });

    it('skips PCM upload when the worklet assigns this loader as a shared-bank follower', async () => {
        const port = makePort({ uploadRequired: false });

        await loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
        });

        expect(postedTypes(port)).not.toContain('addSample');
        expect(postedTypes(port)).toContain('addZone');
        expect(postedTypes(port)).toContain('buildZoneMap');
    });

    it('rejects when the worklet cannot commit the staged bank', async () => {
        const port = makePort({ commitError: 'zone map rejected' });

        await expect(
            loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
            })
        ).rejects.toThrow('zone map rejected');
        expect(decodedBankResource.getDiagnostics().activeLeases).toBe(0);
    });

    it('does not resolve before the worklet acknowledges the committed bank', async () => {
        const port = makePort({ autoComplete: false });
        let settled = false;
        const pending = loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
        }).then(() => {
            settled = true;
            return undefined;
        });

        await vi.waitFor(() => {
            expect(postedTypes(port)).toContain('buildZoneMap');
        });
        expect(settled).toBe(false);
        expect(decodedBankResource.getDiagnostics().activeLeases).toBe(1);
        const buildMessage: unknown = port.postMessage.mock.calls.find(([message]) => {
            return isRecord(message) && message.type === 'buildZoneMap';
        })?.[0];
        if (!isRecord(buildMessage) || typeof buildMessage.loadToken !== 'number') {
            throw new Error('Expected a buildZoneMap message');
        }
        port.emit({ type: 'sampleBankLoaded', loadToken: buildMessage.loadToken });

        await pending;
        expect(settled).toBe(true);
        expect(decodedBankResource.getDiagnostics().activeLeases).toBe(0);
    });

    it('aborts the active worklet transaction while waiting for its commit acknowledgement', async () => {
        // The token is still pending on this fake port when the abort lands
        // (buildZoneMap has not committed — `autoComplete: false`), so the
        // port answers `abortSampleBank` with `sampleBankError` the way the
        // real processor's matched abort does; the promise settles from that
        // answer rather than from an immediate local rejection.
        const port = makePort({ autoComplete: false });
        const controller = new AbortController();
        const pending = loadInstrumentFromManifest({
            manifestUrl: '/m.json',
            basePath: '/base',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
            signal: controller.signal,
        });
        await vi.waitFor(() => {
            expect(postedTypes(port)).toContain('buildZoneMap');
        });

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(postedTypes(port)).toContain('abortSampleBank');
        expect(decodedBankResource.getDiagnostics().activeLeases).toBe(0);
    });

    describe('an abort after buildZoneMap defers to the worklet', () => {
        it('resolves with the committed bank when the worklet already committed before the abort lands', async () => {
            const twoMicManifest = {
                ...MANIFEST,
                micPositions: ['close', 'room'],
                articulations: [
                    {
                        ...MANIFEST.articulations[0],
                        zones: [
                            { ...MANIFEST.articulations[0]!.zones[0], file: 'a.wav', micId: 0 },
                            { ...MANIFEST.articulations[0]!.zones[0], file: 'b.wav', micId: 1 },
                        ],
                    },
                ],
            };
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(twoMicManifest),
                })
            );
            // `deferCommit` clears the port's pending token synchronously on
            // `buildZoneMap` (as the real processor's commit does) but leaves
            // the terminal `sampleBankLoaded` reply for this test to deliver,
            // so the abort-vs-reply race is driven deterministically instead
            // of by timer ordering.
            const port = makePort({ deferCommit: true });
            const controller = new AbortController();
            const pending = loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
                signal: controller.signal,
            });
            await vi.waitFor(() => {
                expect(postedTypes(port)).toContain('buildZoneMap');
            });
            const buildMessage: unknown = port.postMessage.mock.calls.find(([message]) => {
                return isRecord(message) && message.type === 'buildZoneMap';
            })?.[0];
            if (!isRecord(buildMessage) || typeof buildMessage.loadToken !== 'number') {
                throw new Error('Expected a buildZoneMap message');
            }

            controller.abort();
            // The token was already cleared by the commit above, so the
            // abort's `abortSampleBank` finds no match and gets no answer —
            // only the worklet's own delayed reply below may settle this.
            expect(postedTypes(port)).toContain('abortSampleBank');

            port.emit({ type: 'sampleBankLoaded', loadToken: buildMessage.loadToken });

            const bank = await pending;
            expect(bank?.micPositions).toEqual(['close', 'room']);
        });

        // "abort after buildZoneMap while the fake worklet has not committed;
        // it answers the abort with sampleBankError → rejects with the abort
        // reason" is the same scenario the pre-existing
        // 'aborts the active worklet transaction while waiting for its commit
        // acknowledgement' test above already covers — its sequence didn't
        // change, only `makePort`'s abort handling gained the answer that now
        // drives its rejection.

        it.each(['disposed', 'error'] as const)(
            'rejects without a pending promise when the worklet reports %s after the abort',
            async (type) => {
                const port = makePort({ autoComplete: false });
                const controller = new AbortController();
                const pending = loadInstrumentFromManifest({
                    manifestUrl: '/m.json',
                    basePath: '/base',
                    expectedInstrumentId: 'violin-1',
                    nodePort: port,
                    signal: controller.signal,
                });
                await vi.waitFor(() => {
                    expect(postedTypes(port)).toContain('buildZoneMap');
                });

                controller.abort();
                port.emit({ type });

                await expect(pending).rejects.toThrow();
            }
        );
    });

    it('hydrates two concurrent instances from one manifest fetch and one decoded sample', async () => {
        const firstPort = makePort();
        const secondPort = makePort();

        await Promise.all([
            loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: firstPort,
            }),
            loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: secondPort,
            }),
        ]);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetchAndDecode).toHaveBeenCalledTimes(1);
        const firstSample = firstPort.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'addSample';
        });
        const secondSample = secondPort.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'addSample';
        });
        expect(firstSample?.[0]).toMatchObject({ type: 'addSample', sampleId: 0 });
        expect(secondSample?.[0]).toMatchObject({ type: 'addSample', sampleId: 0 });
        expect(getPostedSampleData(firstSample).buffer).toBe(getPostedSampleData(secondSample).buffer);
        const firstBegin = firstPort.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'beginSampleBank';
        });
        const secondBegin = secondPort.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'beginSampleBank';
        });
        const firstBeginMessage: unknown = firstBegin?.[0];
        expect(
            isRecord(firstBeginMessage) &&
                firstBeginMessage.type === 'beginSampleBank' &&
                typeof firstBeginMessage.bankKey === 'string'
        ).toBe(true);
        const secondBeginMessage: unknown = secondBegin?.[0];
        expect(
            isRecord(secondBeginMessage) &&
                secondBeginMessage.type === 'beginSampleBank' &&
                secondBeginMessage.bankKey === (firstBeginMessage as Record<string, unknown>).bankKey &&
                secondBeginMessage.instrumentId === 'violin-1' &&
                secondBeginMessage.loadToken !== (firstBeginMessage as Record<string, unknown>).loadToken
        ).toBe(true);
    });

    it('rejects mismatched bank identity before decoding or mutating the worklet', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ ...MANIFEST, instrumentId: 'cello' }),
            })
        );
        const port = makePort();

        await expect(
            loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
            })
        ).rejects.toThrow('Levain manifest instrument cello does not match requested violin-1');

        expect(fetchAndDecode).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('does not mutate the worklet when any required sample fails', async () => {
        vi.mocked(fetchAndDecode).mockRejectedValueOnce(new Error('decode failed'));
        const port = makePort();

        await expect(
            loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
            })
        ).rejects.toThrow('decode failed');

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('rejects a bank with no playable zones before mutating the worklet', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ ...MANIFEST, articulations: [] }),
            })
        );
        const port = makePort();

        await expect(
            loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
            })
        ).rejects.toThrow('must contain at least one articulation');

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    describe('fix 2 — an aborted (superseded) load never writes the worklet zone map', () => {
        it('does not clear zones when aborted right after the manifest fetch', async () => {
            const controller = new AbortController();
            // Abort as soon as the manifest is requested, before zones are cleared.
            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation(() => {
                    controller.abort();
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANIFEST) });
                })
            );
            const port = makePort();

            await loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
                signal: controller.signal,
            });

            const types = postedTypes(port);
            expect(types).not.toContain('beginSampleBank');
            expect(types).not.toContain('buildZoneMap');
        });

        it('does not let one consumer signal abort the shared manifest fetch', async () => {
            const controller = new AbortController();
            const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(MANIFEST),
                })
            );
            vi.stubGlobal('fetch', fetchMock);
            const port = makePort();

            await loadInstrumentFromManifest({
                manifestUrl: '/m.json',
                basePath: '/base',
                expectedInstrumentId: 'violin-1',
                nodePort: port,
                signal: controller.signal,
            });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const request = fetchMock.mock.calls[0];
            expect(request?.[0]).toBe('/m.json');
            expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal);
            expect(request?.[1]?.signal).not.toBe(controller.signal);
        });
    });
});
