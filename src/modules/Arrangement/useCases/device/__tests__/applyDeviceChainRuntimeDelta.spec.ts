import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { applyDeviceChainRuntimeDelta } from '../applyDeviceChainRuntimeDelta';
import { hasLiveProjectHostTrack } from '../hasLiveProjectHostTrack';

import type { applyRuntimeGraphDelta } from '#/modules/AudioEngine/useCases';
import type { Track } from '../../../stores/trackStore';
import type { projectTrackToLiveStrip } from '../../projectTrackToLiveStrip';

const mocks = vi.hoisted(() => ({
    applyRuntimeGraphDelta: vi.fn<typeof applyRuntimeGraphDelta>(() => ({
        acceptance: 'accepted',
        application: 'applied',
        correlation: { appRevision: 7, projectRevision: 'project-1' },
        runtimeRevision: 8,
    })),
    getRuntimeGraphRevision: vi.fn(() => 7),
    getTrackStrip: vi.fn<(trackId: string) => object | undefined>(() => ({})),
    projectTrackToLiveStrip: vi.fn<typeof projectTrackToLiveStrip>(),
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
    getTrackStrip: mocks.getTrackStrip,
    matchesRuntimeDeviceChainTopology: mocks.matchesRuntimeDeviceChainTopology,
    createRuntimeGraphTopologyFingerprint: (node: unknown) => JSON.stringify(node),
    mirrorDeviceChainDelta: mocks.mirrorDeviceChainDelta,
}));

vi.mock('../../projectTrackToLiveStrip', () => ({ projectTrackToLiveStrip: mocks.projectTrackToLiveStrip }));

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
        mocks.getTrackStrip.mockReturnValue({});
        mocks.projectTrackToLiveStrip.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 7, projectRevision: 'project-1' },
            runtimeRevision: 8,
        });
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(false);
        mocks.mirrorDeviceChainDelta.mockResolvedValue({ outcome: 'skipped', reason: 'no session' });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it.each(['add-device', 'remove-device', 'reorder-device'] as const)(
        'initializes an absent strip from authoritative final project truth for %s',
        (operation) => {
            const before = seedTrack();
            const after = { ...before, devices: operation === 'remove-device' ? [] : before.devices };
            trackStore.set({ tracks: [after], selectedTrackId: after.id, ghostClips: [] });
            mocks.getTrackStrip.mockReturnValue(undefined);
            const result = applyDeviceChainRuntimeDelta({ before, after, operation });
            expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
            expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledExactlyOnceWith({ trackId: after.id });
            expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        }
    );

    it('initializes the composed final chain once and discharges its later grouped step', () => {
        const before = seedTrack();
        const intermediate = { ...before, devices: [] };
        const finalTrack = { ...before, devices: [{ ...before.devices[0]!, id: 'replacement' }] };
        trackStore.set({ tracks: [finalTrack], selectedTrackId: before.id, ghostClips: [] });
        mocks.getTrackStrip.mockReturnValue(undefined);
        const actions = [
            { type: 'removeDevice' as const, payload: { deviceId: 'device-1' } },
            { type: 'addDevice' as const, payload: { trackId: before.id, deviceType: 'builtin-eq' } },
        ];
        const result = applyDeviceChainRuntimeDelta({
            before,
            after: intermediate,
            operation: 'remove-device',
            batchContext: { actions, actionIndex: 0 },
        });
        expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledExactlyOnceWith({ trackId: before.id });
        mocks.getTrackStrip.mockReturnValue({});
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(true);
        const next = applyDeviceChainRuntimeDelta({
            before: intermediate,
            after: finalTrack,
            operation: 'add-device',
            batchContext: { actions, actionIndex: 1 },
        });
        expect(next).toMatchObject({ acceptance: 'superseded', application: 'discharged' });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledTimes(1);
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('does not initialize an absent strip from unrelated project divergence or duplicate ownership', () => {
        const before = seedTrack();
        mocks.getTrackStrip.mockReturnValue(undefined);
        trackStore.set({ tracks: [before], selectedTrackId: before.id, ghostClips: [] });
        applyDeviceChainRuntimeDelta({ before, after: { ...before, devices: [] }, operation: 'remove-device' });
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
        trackStore.set({ tracks: [before, before], selectedTrackId: before.id, ghostClips: [] });
        const duplicate = applyDeviceChainRuntimeDelta({ before, after: before, operation: 'reorder-device' });
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(duplicate).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
    });

    it('preserves rejected and missing initialization outcomes without native mirroring', () => {
        const track = seedTrack();
        mocks.getTrackStrip.mockReturnValue(undefined);
        const rejection = {
            acceptance: 'rejected' as const,
            application: 'not-applied' as const,
            reason: 'stale initialization',
        };
        mocks.projectTrackToLiveStrip.mockReturnValueOnce(rejection).mockReturnValueOnce(undefined);
        expect(applyDeviceChainRuntimeDelta({ before: track, after: track, operation: 'reorder-device' })).toBe(
            rejection
        );
        expect(
            applyDeviceChainRuntimeDelta({ before: track, after: track, operation: 'reorder-device' })
        ).toMatchObject({
            acceptance: 'rejected',
            reason: `Cannot initialize device runtime strip for track ${track.id}`,
        });
        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
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
            reason: 'Live Web Audio already matches the authoritative final device chain for track audio-1',
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
        trackStore.set({ tracks: [after], selectedTrackId: track.id, ghostClips: [] });

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
        trackStore.set({ tracks: [{ ...track, devices: [] }], selectedTrackId: track.id, ghostClips: [] });
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
        trackStore.set({ tracks: [{ ...track, devices: [] }], selectedTrackId: track.id, ghostClips: [] });
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

    it.each(['duplicate owner', 'diverged project'])(
        'does not mirror an accepted result without proven %s authority',
        (state) => {
            const before = seedTrack();
            const after = { ...before, devices: [] };
            trackStore.set({
                tracks: state === 'duplicate owner' ? [after, after] : [before],
                selectedTrackId: before.id,
                ghostClips: [],
            });
            mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(true);

            applyDeviceChainRuntimeDelta({ before, after, operation: 'remove-device' });

            expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
        }
    );

    // A persistent-node match proves only Web Audio. The native carrier still
    // has to apply or explicitly defer the full project chain.
    it('mirrors final project truth for a step Web Audio had already discharged', () => {
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

        expect(mocks.mirrorDeviceChainDelta).toHaveBeenCalledWith({
            before,
            after: expect.objectContaining({ devices: [firstDevice, secondDevice] }),
        });
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
        trackStore.set({ tracks: [{ ...track, devices: [] }], selectedTrackId: track.id, ghostClips: [] });
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
    it.each(['builtin-synth', 'drum-kit'])(
        'compiles %s plus node-backed add/remove/reorder without changing native snapshots',
        (type) => {
            const base = seedTrack();
            const instrument = { id: 'instrument', type, name: 'Instrument', bypassed: false, parameterValues: {} };
            const eq = base.devices[0]!;
            const crust = {
                id: 'crust',
                type: 'crust',
                name: 'Crust',
                bypassed: false,
                parameterValues: { ceiling: -1 },
            };
            const before = { ...base, devices: [instrument, eq] };
            const after = { ...base, devices: [instrument, eq, crust] };
            trackStore.set({ tracks: [after], selectedTrackId: after.id });
            applyDeviceChainRuntimeDelta({ before, after, operation: 'add-device' });
            expect(mocks.applyRuntimeGraphDelta).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    before: expect.objectContaining({
                        devices: [{ id: eq.id, type: eq.type, parameterIds: ['frequency'] }],
                    }),
                    after: expect.objectContaining({
                        devices: [
                            { id: eq.id, type: eq.type, parameterIds: ['frequency'] },
                            { id: crust.id, type: 'crust', parameterIds: ['ceiling'] },
                        ],
                    }),
                })
            );
            expect(mocks.mirrorDeviceChainDelta).toHaveBeenLastCalledWith({ before, after });
            const reordered = { ...after, devices: [crust, instrument, eq] };
            trackStore.set({ tracks: [reordered], selectedTrackId: reordered.id });
            applyDeviceChainRuntimeDelta({ before: after, after: reordered, operation: 'reorder-device' });
            expect(mocks.applyRuntimeGraphDelta).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    operation: 'reorder-device',
                    after: expect.objectContaining({
                        devices: [expect.objectContaining({ id: crust.id }), expect.objectContaining({ id: eq.id })],
                    }),
                })
            );
            trackStore.set({ tracks: [before], selectedTrackId: before.id });
            applyDeviceChainRuntimeDelta({ before: after, after: before, operation: 'remove-device' });
            expect(mocks.applyRuntimeGraphDelta).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    operation: 'remove-device',
                    after: expect.objectContaining({ devices: [expect.objectContaining({ id: eq.id })] }),
                })
            );
        }
    );

    it.each([false, true])(
        'initializes or discharges an instrument-only change with live strip %s and mirrors full native truth',
        (warm) => {
            const before = createTrack({ id: 'midi', name: 'MIDI', kind: 'midi' });
            const drum = { id: 'drum', type: 'drum-kit', name: 'Drum', bypassed: false, parameterValues: { kit: 1 } };
            const after = { ...before, devices: [...before.devices, drum] };
            trackStore.set({ tracks: [after], selectedTrackId: after.id });
            mocks.getTrackStrip.mockReturnValue(warm ? {} : undefined);
            mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(warm);
            const result = applyDeviceChainRuntimeDelta({ before, after, operation: 'add-device' });
            if (warm) {
                expect(result).toMatchObject({ acceptance: 'superseded', application: 'discharged' });
            } else {
                expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
            }
            expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
            expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledTimes(warm ? 0 : 1);
            expect(mocks.mirrorDeviceChainDelta).toHaveBeenCalledWith({ before, after });
        }
    );

    it('discharges a nodeless-only reorder beside a matching effect and still mirrors native order', () => {
        const base = seedTrack();
        const synth = { id: 'synth', type: 'builtin-synth', name: 'Synth', bypassed: false, parameterValues: {} };
        const before = { ...base, devices: [synth, ...base.devices] };
        const after = { ...base, devices: [...base.devices, synth] };
        trackStore.set({ tracks: [after], selectedTrackId: after.id });
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(true);
        expect(applyDeviceChainRuntimeDelta({ before, after, operation: 'reorder-device' })).toMatchObject({
            application: 'discharged',
        });
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(mocks.mirrorDeviceChainDelta).toHaveBeenCalledWith({ before, after });
    });

    it('does not discharge an instrument-only change when the live node chain differs', () => {
        const before = createTrack({ id: 'midi', name: 'MIDI', kind: 'midi' });
        const after = {
            ...before,
            devices: [
                ...before.devices,
                { id: 'drum', type: 'drum-kit', name: 'Drum', bypassed: false, parameterValues: {} },
            ],
        };
        trackStore.set({ tracks: [after], selectedTrackId: after.id });
        mocks.getTrackStrip.mockReturnValue({});
        mocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live chain mismatch',
        });
        expect(applyDeviceChainRuntimeDelta({ before, after, operation: 'add-device' })).toMatchObject({
            acceptance: 'rejected',
        });
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });

    it('composes and discharges grouped final topology through the Web Audio projection while preserving native instruments', () => {
        const before = createTrack({ id: 'midi', name: 'MIDI', kind: 'midi' });
        const crust = { id: 'crust', type: 'crust', name: 'Crust', bypassed: false, parameterValues: { ceiling: -1 } };
        const drum = { id: 'drum', type: 'drum-kit', name: 'Drum', bypassed: false, parameterValues: {} };
        const intermediate = { ...before, devices: [...before.devices, crust] };
        const finalTrack = { ...intermediate, devices: [...intermediate.devices, drum] };
        trackStore.set({ tracks: [finalTrack], selectedTrackId: finalTrack.id });
        const batchContext = {
            actions: [
                { type: 'addDevice' as const, payload: { trackId: before.id, deviceType: 'crust' } },
                { type: 'addDevice' as const, payload: { trackId: before.id, deviceType: 'drum-kit' } },
            ],
            actionIndex: 0,
        };
        applyDeviceChainRuntimeDelta({ before, after: intermediate, operation: 'add-device', batchContext });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenLastCalledWith(
            expect.objectContaining({
                operation: 'replace-device-chain',
                before: expect.objectContaining({ devices: [] }),
                after: expect.objectContaining({
                    devices: [{ id: 'crust', type: 'crust', parameterIds: ['ceiling'] }],
                }),
            })
        );
        expect(mocks.mirrorDeviceChainDelta).toHaveBeenLastCalledWith({ before, after: finalTrack });
        mocks.applyRuntimeGraphDelta.mockClear();
        mocks.matchesRuntimeDeviceChainTopology.mockReturnValue(true);
        expect(
            applyDeviceChainRuntimeDelta({ before, after: intermediate, operation: 'add-device', batchContext })
        ).toMatchObject({ application: 'discharged' });
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(mocks.matchesRuntimeDeviceChainTopology).toHaveBeenLastCalledWith(
            expect.objectContaining({ devices: [{ id: 'crust', type: 'crust', parameterIds: ['ceiling'] }] })
        );
    });
});
