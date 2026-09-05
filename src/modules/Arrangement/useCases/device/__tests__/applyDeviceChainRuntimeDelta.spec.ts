import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { applyDeviceChainRuntimeDelta } from '../applyDeviceChainRuntimeDelta';
import { hasLiveProjectHostTrack } from '../hasLiveProjectHostTrack';

import type { applyRuntimeGraphDelta } from '#/modules/AudioEngine/useCases';
import type { Track } from '../../../stores/trackStore';

const mocks = vi.hoisted(() => ({
    applyRuntimeGraphDelta: vi.fn<typeof applyRuntimeGraphDelta>(() => ({
        acceptance: 'accepted',
        application: 'applied',
        correlation: { appRevision: 7, projectRevision: 'project-1' },
        runtimeRevision: 8,
    })),
    getRuntimeGraphRevision: vi.fn(() => 7),
    matchesRuntimeDeviceChainTopology: vi.fn(() => false),
    captureProjectRevision: vi.fn(() => 'project-1'),
    /**
     * The native carrier's half of the same change (#3575). Doubled because
     * what this file owns is *when* the mirror is fired and with which
     * snapshots; what the mirror then sends has its own spec.
     */
    mirrorDeviceChainDelta: vi.fn<(input: { before: Track; after: Track }) => Promise<unknown>>(() =>
        Promise.resolve({ outcome: 'skipped', reason: 'no session' })
    ),
    warn: vi.fn<(message: string) => void>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    applyRuntimeGraphDelta: mocks.applyRuntimeGraphDelta,
    getRuntimeGraphRevision: mocks.getRuntimeGraphRevision,
    matchesRuntimeDeviceChainTopology: mocks.matchesRuntimeDeviceChainTopology,
    createRuntimeGraphTopologyFingerprint: (node: unknown) => JSON.stringify(node),
    mirrorDeviceChainDelta: mocks.mirrorDeviceChainDelta,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

function seedTrack(): Track {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    track.devices = [
        { id: 'device-1', name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: { frequency: 1000 } },
    ];
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    return track;
}

describe('applyDeviceChainRuntimeDelta', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 7, projectRevision: 'project-1' },
            runtimeRevision: 8,
        });
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(false);
        mocks.mirrorDeviceChainDelta.mockResolvedValue({ outcome: 'skipped', reason: 'no session' });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('submits the delta while the host track is still project truth', () => {
        const track = seedTrack();
        const after = { ...track, devices: [] };

        const result = applyDeviceChainRuntimeDelta({ before: track, after, operation: 'remove-device' });

        expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
    });

    it('reports a delta superseded, without submitting it, once the host track left project truth', () => {
        // Every deferred device-chain effect compiles its snapshots while the
        // action executes but submits them after the whole batch commits. A
        // later action in the same commit that removed the host track leaves the
        // snapshot describing a track project truth no longer has: the engine
        // would reject it as a topology mismatch for a removal that already
        // happened.
        const track = seedTrack();
        const after = { ...track, devices: [] };
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        const result = applyDeviceChainRuntimeDelta({ before: track, after, operation: 'remove-device' });

        expect(result).toEqual({
            acceptance: 'superseded',
            application: 'not-applied',
            reason: 'Track audio-1 left project truth before its remove-device delta was submitted',
        });
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('keeps submitting a delta whose host track is present but no longer matches', () => {
        // Narrowness matters: only the track leaving project truth makes a delta
        // void. A track that is still there and diverged is a genuine mismatch,
        // and the engine has to be the one that says so.
        const track = seedTrack();
        mocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta does not match the current project topology',
        });
        trackStore.set({
            tracks: [{ ...track, devices: [...track.devices, { ...track.devices[0]!, id: 'device-2' }] }],
            selectedTrackId: track.id,
            ghostClips: [],
        });

        const result = applyDeviceChainRuntimeDelta({
            before: track,
            after: { ...track, devices: [] },
            operation: 'remove-device',
        });

        expect(result).toMatchObject({ acceptance: 'rejected' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
    });

    it('composes same-track device mutations to the authoritative final chain', () => {
        const before = seedTrack();
        before.devices = [];
        const firstDevice = {
            id: 'device-1',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: { frequency: 1000 },
        };
        const secondDevice = {
            id: 'device-2',
            name: 'Compressor',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        const intermediate = { ...before, devices: [firstDevice] };
        const finalTrack = { ...before, devices: [firstDevice, secondDevice] };
        trackStore.set({ tracks: [finalTrack], selectedTrackId: before.id, ghostClips: [] });

        const result = applyDeviceChainRuntimeDelta({
            before,
            after: intermediate,
            operation: 'add-device',
            batchContext: {
                actions: [
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: firstDevice.type } },
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: secondDevice.type } },
                ],
                actionIndex: 0,
            },
        });

        expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'replace-device-chain',
                before: expect.objectContaining({ devices: [] }),
                after: expect.objectContaining({
                    devices: [
                        expect.objectContaining({ id: firstDevice.id }),
                        expect.objectContaining({ id: secondDevice.id }),
                    ],
                }),
            })
        );
    });

    it('reports a grouped step discharged only when live runtime already equals final project truth', () => {
        const before = seedTrack();
        before.devices = [];
        const firstDevice = {
            id: 'device-1',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: { frequency: 1000 },
        };
        const secondDevice = {
            id: 'device-2',
            name: 'Compressor',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        const finalTrack = { ...before, devices: [firstDevice, secondDevice] };
        trackStore.set({ tracks: [finalTrack], selectedTrackId: before.id, ghostClips: [] });
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(true);

        const result = applyDeviceChainRuntimeDelta({
            before,
            after: { ...before, devices: [firstDevice] },
            operation: 'add-device',
            batchContext: {
                actions: [
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: firstDevice.type } },
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: secondDevice.type } },
                ],
                actionIndex: 0,
            },
        });

        expect(result).toEqual({
            acceptance: 'superseded',
            application: 'discharged',
            reason: 'Live runtime already matches the authoritative final device chain for track audio-1',
        });
        expect(mocks.matchesRuntimeDeviceChainTopology).toHaveBeenCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({ id: firstDevice.id }),
                    expect.objectContaining({ id: secondDevice.id }),
                ],
            })
        );
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('does not compose unrelated project divergence without a later same-track mutation', () => {
        const before = seedTrack();
        const intermediate = { ...before, devices: [] };
        const divergentDevice = {
            id: 'external-change',
            name: 'External change',
            type: 'builtin-delay',
            bypassed: false,
            parameterValues: {},
        };
        trackStore.set({
            tracks: [{ ...before, devices: [...before.devices, divergentDevice] }],
            selectedTrackId: before.id,
            ghostClips: [],
        });
        mocks.applyRuntimeGraphDelta.mockReturnValueOnce({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta does not match the current project topology',
        });

        const result = applyDeviceChainRuntimeDelta({
            before,
            after: intermediate,
            operation: 'remove-device',
            batchContext: {
                actions: [
                    { type: 'removeDevice', payload: { deviceId: 'device-1', expectedTrackId: before.id } },
                    { type: 'addDevice', payload: { trackId: 'other-track', deviceType: 'builtin-delay' } },
                ],
                actionIndex: 0,
            },
        });

        expect(result).toMatchObject({ acceptance: 'rejected' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device', after: expect.objectContaining({ devices: [] }) })
        );
    });

    it('exposes the same host-track decision to callers that never submit a delta', () => {
        seedTrack();

        expect(hasLiveProjectHostTrack('audio-1')).toBe(true);
        expect(hasLiveProjectHostTrack('missing-1')).toBe(false);
    });

    /**
     * The mirror is the native carrier's copy of the change Web Audio just
     * took. It carries the project snapshots, not the compiled runtime node:
     * the native chain is addressed by device id and the engine's own realized
     * order, which the runtime node does not describe.
     */
    it('mirrors the same snapshots onto the native carrier once Web Audio applied the delta', () => {
        const track = seedTrack();
        const after = { ...track, devices: [] };

        applyDeviceChainRuntimeDelta({ before: track, after, operation: 'remove-device' });

        expect(mocks.mirrorDeviceChainDelta).toHaveBeenCalledWith({ before: track, after });
    });

    /**
     * A rejected delta left the Web Audio graph as it was, so mirroring it
     * would give the native engine a chain no other carrier has — and the
     * repair the rejection asks for would then be reconciling two different
     * wrong graphs.
     */
    it('mirrors nothing when the runtime rejected the delta', () => {
        const track = seedTrack();
        mocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta does not match the current project topology',
        });

        applyDeviceChainRuntimeDelta({
            before: track,
            after: { ...track, devices: [] },
            operation: 'remove-device',
        });

        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });

    // Half-applied: the Web Audio graph is neither the delta's nor the one
    // before it, and only the repair can say which chain to mirror.
    it('mirrors nothing when the runtime needs reconciling', () => {
        const track = seedTrack();
        mocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'failed',
            correlation: { appRevision: 7, projectRevision: 'project-1' },
            reason: 'a live edge could not be restored',
            runtimeRevision: 8,
        });

        applyDeviceChainRuntimeDelta({
            before: track,
            after: { ...track, devices: [] },
            operation: 'remove-device',
        });

        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });

    // The host track is gone from project truth: no delta was submitted, and
    // the removal's own teardown owns the strip that is left.
    it('mirrors nothing for a delta whose host track left project truth', () => {
        const track = seedTrack();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        applyDeviceChainRuntimeDelta({
            before: track,
            after: { ...track, devices: [] },
            operation: 'remove-device',
        });

        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });

    // Discharged: nothing was submitted because the live chain already equals
    // the authoritative target, so there is no change to carry anywhere.
    it('mirrors nothing for a step the live runtime had already discharged', () => {
        const before = seedTrack();
        before.devices = [];
        const firstDevice = {
            id: 'device-1',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: { frequency: 1000 },
        };
        const secondDevice = {
            id: 'device-2',
            name: 'Compressor',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        trackStore.set({
            tracks: [{ ...before, devices: [firstDevice, secondDevice] }],
            selectedTrackId: before.id,
            ghostClips: [],
        });
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(true);

        applyDeviceChainRuntimeDelta({
            before,
            after: { ...before, devices: [firstDevice] },
            operation: 'add-device',
            batchContext: {
                actions: [
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: firstDevice.type } },
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: secondDevice.type } },
                ],
                actionIndex: 0,
            },
        });

        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });

    /**
     * Web Audio was given the composed final chain, so the native carrier has
     * to be given the same one: mirroring the intermediate step would leave the
     * two carriers holding different chains until the next play.
     */
    it('mirrors the composed final chain when the batch composes a grouped step', () => {
        const before = seedTrack();
        before.devices = [];
        const firstDevice = {
            id: 'device-1',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: { frequency: 1000 },
        };
        const secondDevice = {
            id: 'device-2',
            name: 'Compressor',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        const finalTrack = { ...before, devices: [firstDevice, secondDevice] };
        trackStore.set({ tracks: [finalTrack], selectedTrackId: before.id, ghostClips: [] });

        applyDeviceChainRuntimeDelta({
            before,
            after: { ...before, devices: [firstDevice] },
            operation: 'add-device',
            batchContext: {
                actions: [
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: firstDevice.type } },
                    { type: 'addDevice', payload: { trackId: before.id, deviceType: secondDevice.type } },
                ],
                actionIndex: 0,
            },
        });

        expect(mocks.mirrorDeviceChainDelta).toHaveBeenCalledWith({
            before,
            after: expect.objectContaining({ devices: [firstDevice, secondDevice] }),
        });
    });

    /**
     * The mirror is a second carrier, not a second authority. This use case is
     * called from a post-commit effect whose thrown error routes to graph
     * repair, and a native bridge that answered unreadably would send the
     * runtime graph — which is intact — off to be repaired.
     */
    it('returns the runtime result without waiting for a mirror that rejects', async () => {
        const track = seedTrack();
        mocks.mirrorDeviceChainDelta.mockRejectedValue(new Error('unreadable native answer'));

        const result = applyDeviceChainRuntimeDelta({
            before: track,
            after: { ...track, devices: [] },
            operation: 'remove-device',
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('unreadable native answer'));
    });
});
