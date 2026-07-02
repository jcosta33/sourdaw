import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { loadInstrumentFromManifest, type SampleManifest } from '../loadInstrumentFromManifest';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../fetchAndDecode', () => {
    return {
        fetchAndDecode: vi.fn().mockResolvedValue({
            data: new Float32Array([0, 0]),
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

describe('loadInstrumentFromManifest', () => {
    beforeEach(() => {
        mockFetchOk();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('builds the zone map for a normal (un-aborted) load', async () => {
        const port = makePort();

        await loadInstrumentFromManifest('/m.json', '/base', port);

        const types = postedTypes(port);
        expect(types).toContain('clearZones');
        expect(types).toContain('addSample');
        expect(types).toContain('buildZoneMap');
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

            await loadInstrumentFromManifest('/m.json', '/base', port, undefined, undefined, controller.signal);

            const types = postedTypes(port);
            expect(types).not.toContain('clearZones');
            expect(types).not.toContain('buildZoneMap');
        });

        it('passes the signal to the manifest fetch', async () => {
            const controller = new AbortController();
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve(MANIFEST),
            });
            vi.stubGlobal('fetch', fetchMock);
            const port = makePort();

            await loadInstrumentFromManifest('/m.json', '/base', port, undefined, undefined, controller.signal);

            expect(fetchMock).toHaveBeenCalledWith('/m.json', { signal: controller.signal });
        });
    });
});
