import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { compileLoadPresetActions, getAgentPresetDiscoveryManifest } from '#/modules/Arrangement/useCases';
import { renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';

import { renderPresetPreview } from '../renderPresetPreview';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...original,
        compileLoadPresetActions: vi.fn(original.compileLoadPresetActions),
        getAgentPresetDiscoveryManifest: vi.fn(original.getAgentPresetDiscoveryManifest),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderTrackSubgraphOffline: vi.fn(),
}));

registerDeviceEnginePorts();
const actual = await vi.importActual<typeof import('#/modules/Arrangement/useCases')>('#/modules/Arrangement/useCases');
const catalog = actual.getAgentPresetDiscoveryManifest();
const render = vi.mocked(renderTrackSubgraphOffline);
let generation = 0;
let sampleRate = 48_000;

// A controlled renderer result exercises admission/cache only; browser library.spec owns real PCM proof.
function pcm(rate = sampleRate, seconds = 6): AudioBuffer {
    const channels = [
        new Float32Array(Math.round(rate * seconds)).fill(0.1),
        new Float32Array(Math.round(rate * seconds)).fill(0.2),
    ];
    const channelData = (channel: number) => {
        const data = channels[channel];
        if (!data) {
            throw new RangeError('Missing channel');
        }
        return data;
    };
    return {
        sampleRate: rate,
        duration: seconds,
        length: channels[0]!.length,
        numberOfChannels: channels.length,
        getChannelData: channelData,
        copyFromChannel: (destination, channel, offset = 0) =>
            destination.set(channelData(channel).subarray(offset, offset + destination.length)),
        copyToChannel: (source, channel, offset = 0) => channelData(channel).set(source, offset),
    };
}

function request(presetId = 'factory-bass-acid') {
    return { presetId, sampleRate, signal: new AbortController().signal, isCurrent: () => true };
}

beforeEach(() => {
    generation++;
    sampleRate = 48_000;
    vi.mocked(getAgentPresetDiscoveryManifest)
        .mockReset()
        .mockImplementation(() =>
            catalog.map((entry) => ({ ...entry, version: `${entry.version}:fixture-${generation}` }))
        );
    vi.mocked(compileLoadPresetActions).mockReset().mockImplementation(actual.compileLoadPresetActions);
    render.mockReset().mockImplementation(async (input) => {
        input.onScheduled?.({ scheduledNotes: 3, scheduledBuffers: [], withheldDeviceTypes: [] });
        return pcm();
    });
});

describe('renderPresetPreview owner composition and completed PCM admission', () => {
    it('renders the complete compiled instrument/insert chain in explicit isolated input', async () => {
        const original = actual.compileLoadPresetActions({ presetId: 'factory-bass-acid' });
        const load = original?.actions.find((action) => action.type === 'loadPreset');
        if (!load) {
            throw new Error('Real Acid Bass fixture unavailable');
        }
        const prepared = await renderPresetPreview(request());
        expect(prepared?.isCurrent()).toBe(true);
        expect(compileLoadPresetActions).toHaveBeenCalledWith({ presetId: 'factory-bass-acid' });
        const input = render.mock.calls[0]?.[0];
        expect(input).toMatchObject({
            startBeat: 0,
            endBeat: 4,
            tailSeconds: 4,
            includeInserts: true,
            includeAutomation: false,
            includeSends: false,
            targetMixer: 'keepLive',
        });
        const track = input?.renderTracks[0];
        expect(track?.devices.map(({ id: _id, ...device }) => device)).toEqual(
            load.payload.devices.map(({ id: _id, ...device }) => device)
        );
        expect(input?.source?.project.tracks?.tracks).toEqual([track]);
        expect(input?.source?.project).toMatchObject({
            midi: { probabilitySeed: 1, ccByClipId: {}, pitchBendByClipId: {}, noteCoordinateFormat: 'clip-relative' },
            transport: { tempo: 120, timeSignatureNumerator: 4, timeSignatureDenominator: 4 },
            automationLanes: [],
            takeLanes: { lanes: [] },
            gainEnvelopes: {},
            sidechainRoutes: [],
            vcaGroups: [],
            grooveTemplates: { templates: [], assignments: [] },
            chordTrack: { enabled: false, events: [] },
            yeastProcessorsByDevice: {},
        });
        expect(Object.values(input?.source?.project.midi?.notesByClipId ?? {}).flat()).toEqual([
            expect.objectContaining({ pitch: 48, startBeat: 0, duration: 0.75, velocity: 110 }),
            expect.objectContaining({ pitch: 55, startBeat: 1, duration: 0.75, velocity: 78 }),
            expect.objectContaining({ pitch: 60, startBeat: 2, duration: 1, velocity: 96 }),
        ]);
        expect(input?.source?.runtime).toMatchObject({
            deviceLatencyMs: new Map(),
            loadedExternalInstanceIds: new Set(),
            externalPluginParameters: null,
            calibrationByDevice: new Map(),
            soloMode: 'sip',
        });
        expect(input?.source?.runtime?.buffers.get('any-live-asset')).toBeUndefined();
    });

    it('places the same real default synth excitation before the exact effects-only chain', async () => {
        await renderPresetPreview(request('fx-rev-plate'));
        const devices = render.mock.calls[0]?.[0].renderTracks[0]?.devices;
        expect(devices?.[0]).toMatchObject({ type: 'builtin-synth', parameterValues: {}, bypassed: false });
        const original = actual.compileLoadPresetActions({ presetId: 'fx-rev-plate' });
        const load = original?.actions.find((action) => action.type === 'loadPreset');
        expect(devices?.slice(1).map(({ id: _id, ...device }) => device)).toEqual(
            load?.payload.devices.map(({ id: _id, ...device }) => device)
        );
    });

    it('reuses only completed same-contract/same-rate buffers and misses on version or rate', async () => {
        const first = await renderPresetPreview(request());
        expect((await renderPresetPreview(request()))?.buffer).toBe(first?.buffer);
        expect(render).toHaveBeenCalledTimes(1);
        generation++;
        await renderPresetPreview(request());
        expect(render).toHaveBeenCalledTimes(2);
        sampleRate = 44_100;
        await renderPresetPreview(request());
        expect(render).toHaveBeenCalledTimes(3);
    });

    it('never caches a render cancelled before completion; a later request renders again', async () => {
        const held = Promise.withResolvers<AudioBuffer | null>();
        render.mockImplementationOnce(async (input) => {
            input.onScheduled?.({ scheduledNotes: 3, scheduledBuffers: [], withheldDeviceTypes: [] });
            return held.promise;
        });
        const controller = new AbortController();
        const pending = renderPresetPreview({ ...request(), signal: controller.signal });
        expect(render).toHaveBeenCalledTimes(1);
        controller.abort();
        held.resolve(pcm());
        expect(await pending).toBeNull();
        await renderPresetPreview(request());
        expect(render).toHaveBeenCalledTimes(2);
    });

    it('retires obsolete contract results and final capabilities instead of caching or playing them', async () => {
        const held = Promise.withResolvers<AudioBuffer | null>();
        render.mockImplementationOnce(async (input) => {
            input.onScheduled?.({ scheduledNotes: 3, scheduledBuffers: [], withheldDeviceTypes: [] });
            return held.promise;
        });
        const pending = renderPresetPreview(request());
        generation++;
        held.resolve(pcm());
        expect(await pending).toBeNull();
        const current = await renderPresetPreview(request());
        expect(render).toHaveBeenCalledTimes(2);
        expect(current?.isCurrent()).toBe(true);
        generation++;
        expect(current?.isCurrent()).toBe(false);
    });

    it('retires a renderer rejection after its authoritative preset contract changes', async () => {
        const held = Promise.withResolvers<AudioBuffer | null>();
        render.mockReturnValueOnce(held.promise);
        const pending = renderPresetPreview(request());
        generation++;
        held.reject(new Error('Obsolete render failed'));
        await expect(pending).resolves.toBeNull();
        await renderPresetPreview(request());
        expect(render).toHaveBeenCalledTimes(2);
    });

    it.each(['warning', 'withheld', 'short', 'nonfinite', 'silent', 'null', 'rejected'] as const)(
        'rejects %s output without admitting a cache entry',
        async (kind) => {
            render.mockImplementationOnce(async (input) => {
                input.onScheduled?.({
                    scheduledNotes: 3,
                    scheduledBuffers: [],
                    withheldDeviceTypes: kind === 'withheld' ? ['builtin-synth'] : [],
                });
                if (kind === 'warning') {
                    input.onWarning?.('Device degraded');
                }
                if (kind === 'rejected') {
                    throw new Error('renderer failed');
                }
                if (kind === 'null') {
                    return null;
                }
                const buffer = pcm(sampleRate, kind === 'short' ? 1 : 6);
                if (kind === 'nonfinite') {
                    buffer.getChannelData(1)[12] = NaN;
                }
                if (kind === 'silent') {
                    buffer.getChannelData(0).fill(0);
                    buffer.getChannelData(1).fill(0);
                }
                return buffer;
            });
            await expect(renderPresetPreview(request())).rejects.toThrow();
            await renderPresetPreview(request());
            expect(render).toHaveBeenCalledTimes(2);
        }
    );

    it('rejects an unknown claimed instrument rather than substituting a default synth', async () => {
        const compiled = actual.compileLoadPresetActions({ presetId: 'factory-bass-acid' });
        if (!compiled) {
            throw new Error('Real preset missing');
        }
        vi.mocked(compileLoadPresetActions).mockReturnValue({
            ...compiled,
            actions: compiled.actions.map((action) => {
                if (action.type !== 'loadPreset') {
                    return action;
                }
                return {
                    ...action,
                    payload: {
                        ...action.payload,
                        devices: action.payload.devices.map((device, index) =>
                            index === 0 ? { ...device, type: 'unknown-instrument' } : device
                        ),
                    },
                };
            }),
        });
        await expect(renderPresetPreview(request())).rejects.toThrow('Unsupported preview device');
        expect(render).not.toHaveBeenCalled();
    });

    it('evicts by entry limit, preserving recently reused complete buffers', async () => {
        const ids = catalog
            .filter((entry) => entry.trackKind === 'midi' && entry.deviceTypes[0] === 'builtin-synth')
            .slice(0, 9)
            .map((entry) => entry.id);
        expect(ids).toHaveLength(9);
        for (const id of ids.slice(0, 8)) {
            await renderPresetPreview(request(id));
        }
        await renderPresetPreview(request(ids[0]));
        await renderPresetPreview(request(ids[8]));
        expect(render).toHaveBeenCalledTimes(9);
        await renderPresetPreview(request(ids[0]));
        expect(render).toHaveBeenCalledTimes(9);
        await renderPresetPreview(request(ids[1]));
        expect(render).toHaveBeenCalledTimes(10);
    });

    it('evicts by PCM byte budget before the entry limit', async () => {
        sampleRate = 192_000;
        const ids = ['factory-bass-acid', 'factory-pad-warm', 'fx-rev-plate', 'fx-eq-vocal-presence'];
        for (const id of ids) {
            await renderPresetPreview(request(id));
        }
        expect(render).toHaveBeenCalledTimes(4);
        await renderPresetPreview(request(ids[0]));
        expect(render).toHaveBeenCalledTimes(5);
    });
});
