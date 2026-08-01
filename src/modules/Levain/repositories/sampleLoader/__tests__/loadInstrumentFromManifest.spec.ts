import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { decodedBankResource } from '../decodedBankResource';
import { fetchAndDecode } from '../fetchAndDecode';
import { loadInstrumentFromManifest, type SampleManifest } from '../loadInstrumentFromManifest';

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

const MANIFEST: SampleManifest = {
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

function makePort(): MessagePort & { postMessage: ReturnType<typeof vi.fn> } {
    return { postMessage: vi.fn() } as unknown as MessagePort & { postMessage: ReturnType<typeof vi.fn> };
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

        const types = postedTypes(port);
        expect(types).toContain('clearZones');
        expect(types).toContain('addSample');
        expect(types).toContain('buildZoneMap');
        const addSampleCall = port.postMessage.mock.calls.find(([message]) => {
            return (message as { type: string }).type === 'addSample';
        });
        expect(addSampleCall).toHaveLength(1);
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
        ).rejects.toThrow('no playable zones');

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
            expect(types).not.toContain('clearZones');
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
