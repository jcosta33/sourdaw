import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort, flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, projectTrackToLiveStrip, restoreTrackSnapshot, runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import { audioEngine, configureRuntimeGraphProjectRevisionValidator, configureRuntimeGraphTopologyValidator } from '#/modules/AudioEngine/useCases';
import { captureProjectRevision, createCrdtDoc, getCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { workspaceStore, defaultWorkspaceState } from '#/modules/WorkspaceShell/stores';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { ensureTrackStrips } from '../ensureTrackStrips';

// Only platform primitives are controlled. The projector, compiler, engine,
// TrackNode, BusNode and builtin EQ factory all execute their production code.
describe('project strip initialization before bus facade and send publication', () => {
    const originalContextProperties = Object.getOwnPropertyDescriptors(audioEngine.context);
    let edges: Map<object, Set<unknown>>;
    let platform: ReturnType<typeof createMockAudioContext>;
    let privateConstruction: Array<{ busId: string; published: boolean }>;
    let facades: Array<{ busId: string; devices: string[] }>;
    let expectedConstructionOrder: string[];
    let filterCount: number;

    function tracksWithSends(): Track[] {
        const source = createTrack({ id: 'source', name: 'Source', kind: 'audio', withoutDefaultDevice: true });
        const first = createTrack({ id: 'first-bus', name: 'First bus', kind: 'bus', withoutDefaultDevice: true });
        const later = createTrack({ id: 'later-bus', name: 'Later bus', kind: 'bus', withoutDefaultDevice: true });
        first.outputId = later.id;
        for (const bus of [first, later]) {
            bus.gain = 0.4;
            bus.devices = [{ id: `${bus.id}-eq`, type: 'builtin-eq', name: 'EQ', bypassed: false, parameterValues: { 'eq-low-gain': 2 } }];
        }
        source.sends = [{ busId: first.id, level: 0.3, preFader: true }];
        first.sends = [{ busId: later.id, level: 0.4, preFader: false }];
        later.sends = [{ busId: first.id, level: 0.2, preFader: true }];
        return [source, first, later];
    }

    function installTracks(tracks: Track[]): void {
        restoreTrackSnapshot({ tracks, selectedTrackId: null });
        flushAutomergeStorageWrites();
    }

    function expectSend(sourceId: string, busId: string, preFader: boolean): void {
        const source = audioEngine.getTrackStrip(sourceId);
        const bus = audioEngine.getTrackStrip(busId);
        expect(source).toBeDefined();
        expect(bus).toBeDefined();
        if (!source || !bus) throw new Error('Required real send endpoints were not published');
        const tap = preFader ? source.preFaderSendGate : source.carrierGate;
        const sendGains = [...(edges.get(tap) ?? [])].filter((node) => typeof node === 'object' && node !== null && edges.get(node)?.has(bus.gainNode));
        expect(sendGains).toHaveLength(1);
    }

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        audioEngine.resetGraph();
        const WorkletNode = globalThis.AudioWorkletNode;
        vi.stubGlobal('AudioWorkletNode', class extends WorkletNode {
            constructor(...args: ConstructorParameters<typeof WorkletNode>) {
                super(...args);
                this.port.close = vi.fn();
            }
        });
        platform = createMockAudioContext();
        edges = new Map();
        privateConstruction = [];
        facades = [];
        filterCount = 0;
        expectedConstructionOrder = ['later-bus', 'first-bus'];
        // Keep current edges, rather than a connect-call history that would also
        // count disconnected speculative or rebuilt routes as live connections.
        for (const factoryName of ['createGain', 'createStereoPanner', 'createAnalyser', 'createBiquadFilter', 'createDelay'] as const) {
            const factory = platform[factoryName].getMockImplementation();
            if (!factory) throw new Error(`Missing platform primitive ${factoryName}`);
            Object.defineProperty(audioEngine.context, factoryName, { configurable: true, value: () => {
                if (factoryName === 'createBiquadFilter') {
                    const busId = expectedConstructionOrder[Math.floor(filterCount / 3)];
                    if (!busId) throw new Error('Unexpected EQ construction');
                    privateConstruction.push({ busId, published: audioEngine.getTrackStrip(busId) !== undefined });
                    filterCount++;
                }
                const node = factory();
                const destinations = new Set<unknown>();
                edges.set(node, destinations);
                Object.defineProperty(node, 'connect', { value: (target: unknown) => { destinations.add(target); return target; } });
                Object.defineProperty(node, 'disconnect', { value: (target?: unknown) => { if (target === undefined) destinations.clear(); else destinations.delete(target); } });
                const parameters = [...('gain' in node ? [node.gain] : []), ...('pan' in node ? [node.pan] : [])];
                for (const parameter of parameters) {
                    for (const method of ['setTargetAtTime', 'setValueAtTime', 'linearRampToValueAtTime']) {
                        Object.defineProperty(parameter, method, { value: (value: number) => { parameter.value = value; } });
                    }
                }
                return node;
            } });
        }
        Object.defineProperty(audioEngine.context, 'currentTime', { configurable: true, value: 0 });
        const ensureBus = audioEngine.ensureBusStrip.bind(audioEngine);
        vi.spyOn(audioEngine, 'ensureBusStrip').mockImplementation((busId) => {
            facades.push({ busId, devices: audioEngine.getTrackStrip(busId)?.deviceNodes.map((device) => device.deviceId) ?? [] });
            return ensureBus(busId);
        });
        createCrdtDoc('root');
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys }),
        });
        configureRuntimeGraphProjectRevisionValidator((revision) => revision === captureProjectRevision());
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        workspaceStore.set({ ...defaultWorkspaceState, soloMode: 'sip' });
    });

    afterEach(() => {
        audioEngine.resetGraph();
        configureRuntimeGraphProjectRevisionValidator(null);
        configureRuntimeGraphTopologyValidator(null);
        restoreTrackSnapshot({ tracks: [], selectedTrackId: null });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        removeCrdtDoc('revision-change');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        for (const key of Object.keys(Object.getOwnPropertyDescriptors(audioEngine.context))) {
            const original = originalContextProperties[key];
            if (original) Object.defineProperty(audioEngine.context, key, original);
            else Reflect.deleteProperty(audioEngine.context, key);
        }
    });

    it('constructs complete private bus chains before facades and cyclic sends, then rebuilds without duplication', () => {
        installTracks(tracksWithSends());
        const result = ensureTrackStrips();
        expect(privateConstruction, `Facades observed before real EQ construction: ${JSON.stringify(facades)}`).toHaveLength(6);
        expect(result.status).toBe('ready');
        expect(privateConstruction).toEqual(['later-bus', 'first-bus'].flatMap((busId) => Array.from({ length: 3 }, () => ({ busId, published: false }))));
        expect(facades).toEqual(['first-bus', 'later-bus'].map((busId) => ({ busId, devices: [`${busId}-eq`] })));
        for (const busId of ['first-bus', 'later-bus']) {
            expect(audioEngine.getTrackStrip(busId)?.deviceNodes.map(({ deviceId, parameterIds }) => ({ deviceId, parameterIds }))).toEqual([{ deviceId: `${busId}-eq`, parameterIds: ['eq-low-gain'] }]);
            expect(audioEngine.getDeviceReadinessDiagnostics().devices.find((device) => device.deviceId === `${busId}-eq`)).toMatchObject({ deviceId: `${busId}-eq`, status: 'ready', failureStage: null });
        }
        const first = audioEngine.getTrackStrip('first-bus');
        const later = audioEngine.getTrackStrip('later-bus');
        expect(edges.get(first!.carrierGate)?.has(later!.gainNode)).toBe(true);
        expectSend('source', 'first-bus', true);
        expectSend('first-bus', 'later-bus', false);
        expectSend('later-bus', 'first-bus', true);
        expect(ensureTrackStrips().status).toBe('ready');
        expect(privateConstruction).toHaveLength(6);
        expectSend('source', 'first-bus', true);
    });

    it.each(['muted', 'sip', 'pfl'] as const)('preserves %s bus gain and send gates after facade creation', (mode) => {
        const tracks = tracksWithSends();
        const first = tracks[1]!;
        first.soloSafe = false;
        first.muted = mode === 'muted';
        first.soloed = mode === 'pfl';
        tracks[0]!.soloed = mode === 'sip';
        workspaceStore.set({ ...defaultWorkspaceState, soloMode: mode === 'pfl' ? 'pfl' : 'sip' });
        installTracks(tracks);
        expect(ensureTrackStrips().status).toBe('ready');
        const strip = audioEngine.getTrackStrip(first.id)!;
        expect(strip.deviceNodes.map((device) => device.deviceId)).toEqual([`${first.id}-eq`]);
        expect(strip.faderNode.gain.value).toBe(mode === 'pfl' ? 1 : 0.4);
        expect(strip.muted).toBe(mode !== 'pfl');
        expect(strip.soloGated).toBe(mode === 'sip');
        expectSend('source', first.id, true);
    });

    it('does not publish a bus or wire sends when its real EQ constructor throws', () => {
        installTracks(tracksWithSends());
        Object.defineProperty(audioEngine.context, 'createBiquadFilter', { value: () => { throw new Error('physical biquad construction failed'); }, configurable: true });
        expect(ensureTrackStrips()).toMatchObject({ status: 'failed', reason: expect.stringContaining('physical biquad construction failed') });
        expect(audioEngine.getTrackStrip('later-bus')).toBeUndefined();
        expect(audioEngine.getTrackStrip('first-bus')).toBeUndefined();
        expect(facades).toEqual([]);
        // Failed private construction disposes its token (TrackNode.dispose),
        // so the terminal record is absent while the failure count survives.
        expect(audioEngine.getDeviceReadinessDiagnostics()).toMatchObject({
            counts: { requested: 1, failed: 1, playableReady: 0 },
            devices: [],
        });
    });

    it.each(['empty', 'wrong nonempty'] as const)('retains rejection of an existing %s bus instead of adopting it', (existing) => {
        const tracks = tracksWithSends();
        const bus = tracks[2]!;
        installTracks([{ ...bus, devices: existing === 'empty' ? [] : [{ ...bus.devices[0]!, id: 'different-eq' }], sends: [] }]);
        expect(projectTrackToLiveStrip({ trackId: bus.id })).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        const before = audioEngine.getTrackStrip(bus.id);
        installTracks(tracks);
        facades.length = 0;
        expect(ensureTrackStrips()).toMatchObject({ status: 'failed', reason: expect.stringContaining('Live source strip does not match') });
        expect(audioEngine.getTrackStrip(bus.id)).toBe(before);
        expect(facades).toEqual([]);
    });

    it.each(['runtime', 'project', 'topology'] as const)('preserves stale %s snapshot rejection without constructors or publication', (stale) => {
        const bus = tracksWithSends()[2]!;
        installTracks([bus]);
        const snapshot = { schemaVersion: 1, command: 'initialize-track-strip', correlation: { appRevision: audioEngine.getRuntimeGraphRevision(), projectRevision: captureProjectRevision() }, nodes: [runtimeGraphTopology.createNode(bus)], output: { kind: 'output', sourceId: bus.id, targetId: 'master' }, parameters: [] };
        if (stale === 'runtime') audioEngine.ensureTrackStrip('unrelated');
        if (stale === 'project') createCrdtDoc('revision-change');
        if (stale === 'topology') installTracks([{ ...bus, devices: [] }]);
        expect(audioEngine.initializeTrackStripFromSnapshot(snapshot)).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(audioEngine.getTrackStrip(bus.id)).toBeUndefined();
        expect(privateConstruction).toEqual([]);
        expect(facades).toEqual([]);
    });

    it('rejects ambiguous bus ownership before creating any facade', () => {
        const tracks = tracksWithSends();
        installTracks([...tracks, { ...tracks[1]! }]);
        expect(trackStore.value?.tracks.filter((track) => track.id === 'first-bus')).toHaveLength(2);
        expect(ensureTrackStrips()).toMatchObject({ status: 'failed', reason: 'The project has an ambiguous bus owner' });
        expect(facades).toEqual([]);
        expect(privateConstruction).toEqual([]);
    });

    it('does not create an ineligible send-target facade', () => {
        const source = createTrack({ id: 'source', name: 'Source', kind: 'audio' });
        const target = createTrack({ id: 'target', name: 'Dormant VCA', kind: 'audio' });
        Object.defineProperty(target, 'kind', { value: 'vca' });
        source.sends = [{ busId: target.id, level: 0.5, preFader: true }];
        // Restore sanitizes legacy kinds. Exercise the legacy current projection
        // directly, as the existing projector admission specs do.
        configureAutomergeStoragePort(null);
        trackStore.set({ tracks: [source, target], selectedTrackId: null });
        expect(trackStore.value?.tracks.find((track) => track.id === target.id)).toMatchObject({ kind: 'vca' });
        expect(ensureTrackStrips().status).toBe('ready');
        expect(audioEngine.getTrackStrip(source.id)).toBeDefined();
        expect(audioEngine.getTrackStrip(target.id)).toBeUndefined();
        expect(facades).toEqual([]);
    });

    it.each(['source', 'send target'] as const)('stops before facade creation for an ambiguous %s', (ambiguous) => {
        const source = createTrack({ id: 'source', name: 'Source', kind: 'audio' });
        const target = createTrack({ id: 'target', name: 'Target', kind: 'audio' });
        source.sends = [{ busId: target.id, level: 0.5, preFader: false }];
        installTracks([source, target, { ...(ambiguous === 'source' ? source : target) }]);
        expect(ensureTrackStrips().status).toBe('failed');
        expect(facades).toEqual([]);
        expect(audioEngine.getTrackStrip(ambiguous === 'source' ? source.id : target.id)).toBeUndefined();
    });

    it('rejects an initialization captured before an identical bus is removed and recreated', () => {
        const bus = tracksWithSends()[2]!;
        bus.sends = [];
        expectedConstructionOrder = [bus.id, bus.id];
        installTracks([bus]);
        expect(projectTrackToLiveStrip({ trackId: bus.id })).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        const original = audioEngine.getTrackStrip(bus.id);
        const snapshot = { schemaVersion: 1, command: 'initialize-track-strip', correlation: { appRevision: audioEngine.getRuntimeGraphRevision(), projectRevision: captureProjectRevision() }, nodes: [runtimeGraphTopology.createNode(bus)], output: { kind: 'output', sourceId: bus.id, targetId: 'master' }, parameters: [] };
        audioEngine.removeTrackStrip(bus.id);
        expect(projectTrackToLiveStrip({ trackId: bus.id })).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        const replacement = audioEngine.getTrackStrip(bus.id);
        expect(replacement).not.toBe(original);
        expect(audioEngine.initializeTrackStripFromSnapshot(snapshot)).toMatchObject({ acceptance: 'rejected', application: 'not-applied', reason: expect.stringContaining('stale') });
        expect(audioEngine.getTrackStrip(bus.id)).toBe(replacement);
        expect(privateConstruction).toHaveLength(6);
    });

});
