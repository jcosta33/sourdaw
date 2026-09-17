/**
 * The live backend's one job: read `apply_graph_commands` and invent nothing.
 *
 * The command answers three outcomes and no others, and each one means
 * something different to a caller deciding whether the native engine took the
 * session. The cases below pin every one of them, plus the two shapes that are
 * *not* outcomes — a transport failure, which is a refusal, and a malformed
 * answer, which is a seam defect and must throw rather than pass as a result a
 * caller would act on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { createNativeLiveGraphBackend } from '../createNativeLiveGraphBackend';
import { type NativeGraphTransport } from '../nativeGraphTransport';
import { registerNativeSampleBanks } from '../registerNativeSampleBanks';
import {
    claimedNativeSampleBankKeysByBackend,
    inFlightNativeSampleBankShipments,
    registeredNativeSampleBankKeys,
} from '../registeredNativeSampleBankKeys';

const BATCH: AudioGraphCommandBatch = {
    schemaVersion: 1,
    commands: [
        {
            kind: 'create-track-strip',
            trackId: 'audio-1',
            name: 'Track 1',
            state: { gain: 0.8, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
            devices: [],
            honorMuted: true,
            contributesAudio: false,
        },
        { kind: 'set-transport', playing: true, positionSeconds: 0 },
    ],
};

/**
 * Every method rejects except `applyGraphCommands`: the live backend must reach
 * the engine through that one command, so a backend that started probing or
 * registering material would fail here rather than pass on a permissive stub.
 */
function stubTransport(applyGraphCommands: NativeGraphTransport['applyGraphCommands']): NativeGraphTransport {
    const unexpected = (name: string) => () => Promise.reject(new Error(`the live backend must not call ${name}`));
    return {
        applyGraphCommands,
        registerTimelineSample: unexpected('register_timeline_sample'),
        beginLevainBank: unexpected('begin_levain_bank'),
        registerLevainSample: unexpected('register_levain_sample'),
        commitLevainBank: unexpected('commit_levain_bank'),
        releaseLevainBank: unexpected('release_levain_bank'),
        renderGraphOffline: unexpected('render_graph_offline'),
        mapGraphBatch: unexpected('map_graph_batch'),
    };
}

describe('createNativeLiveGraphBackend', () => {
    it('applies the serialized batch through apply_graph_commands', async () => {
        const applyGraphCommands = vi.fn().mockResolvedValue({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [],
        });

        await createNativeLiveGraphBackend({ transport: stubTransport(applyGraphCommands) }).apply(BATCH);

        expect(applyGraphCommands).toHaveBeenCalledWith({
            batch: {
                schemaVersion: 1,
                commands: [
                    {
                        kind: 'create-track-strip',
                        trackId: 'audio-1',
                        name: 'Track 1',
                        state: { gain: 0.8, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                        devices: [],
                        honorMuted: true,
                        contributesAudio: false,
                    },
                    { kind: 'set-transport', playing: true, positionSeconds: 0 },
                ],
            },
        });
    });

    it('reads an applied answer with its revision and its strip reports', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 4,
                // The fence this batch drained at: what a pass dates its
                // snapshots against. Optional on the wire, but carried verbatim
                // whenever the native side reports one.
                admittedBatch: 6,
                reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 4,
            admittedBatch: 6,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
            // A batch that attached no dormant instance says so, rather than
            // leaving the caller to tell "attached none" from "did not answer".
            // Both populations answer, because both decide a carrier.
            attachedPlugins: [],
            attachedCrumbs: [],
        });
    });

    // The list exists because the load that created these instances already
    // told their devices there was no engine, and nothing else ever revises
    // that. A payload without the field attached nothing — it is not a defect
    // the way an unreadable outcome is — and an entry that does not name an
    // instance is dropped rather than guessed at, because a substituted id
    // would mark an instance attached that the engine never took.
    it('reads the instances an engine start took over, and drops an entry it cannot read', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 4,
                reports: [],
                attachedPlugins: [
                    { instanceId: 'inst-1' },
                    { instanceId: 'inst-2' },
                    {},
                    { instanceId: 7 },
                    { instanceId: null },
                ],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toMatchObject({
            attachedPlugins: [{ instanceId: 'inst-1' }, { instanceId: 'inst-2' }],
        });
    });

    // Same rule, second population (#4204): a Crumbs instance is named by its
    // device's own id, and marking one the engine never took builds a topology
    // the mapper refuses whole.
    it('reads the Crumbs instances a batch took over, and drops an entry it cannot read', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 4,
                reports: [],
                attachedCrumbs: [{ instanceId: 'd-crumbs' }, {}, { instanceId: 7 }, { instanceId: null }],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toMatchObject({ attachedCrumbs: [{ instanceId: 'd-crumbs' }] });
    });

    it('echoes a correlation back only when the batch carried one', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({ acceptance: 'accepted', application: 'applied', runtimeRevision: 1, reports: [] })
        );
        const correlation = { appRevision: 2, projectRevision: 'rev-9' };

        const carried = await createNativeLiveGraphBackend({ transport }).apply({ ...BATCH, correlation });
        const uncorrelated = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(carried).toMatchObject({ correlation });
        expect(uncorrelated).not.toHaveProperty('correlation');
    });

    it('carries a refusal through with the reason the native side gave', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'rejected',
                application: 'not-applied',
                reason: 'engine-not-running: no default output device',
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'engine-not-running: no default output device',
            attachedCrumbs: [],
        });
    });

    // The attach runs before the batch is mapped, so a refusal can report one.
    // Dropping it here would leave a sampler the engine is now rendering on Web
    // Audio for the rest of the session — and a refusal is exactly when the
    // producer resends the topology that would have claimed it.
    it('keeps the Crumbs instances a refused answer attached before refusing', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'rejected',
                application: 'not-applied',
                reason: 'the engine refused command 2 of 5',
                attachedCrumbs: [{ instanceId: 'd-crumbs' }, { instanceId: 7 }],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'the engine refused command 2 of 5',
            attachedCrumbs: [{ instanceId: 'd-crumbs' }],
        });
    });

    it('carries a partial application as needs-reconcile, never as applied', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'not-attempted',
                reason: 'the engine refused command 2 of 5',
                runtimeRevision: 7,
                reports: [{ kind: 'bus', id: 'bus-1', deviceIds: [] }],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'the engine refused command 2 of 5',
            runtimeRevision: 7,
            reports: [{ kind: 'bus', id: 'bus-1', deviceIds: [] }],
            attachedCrumbs: [],
        });
    });

    it('turns a transport failure into a refusal, so a caller reads one failure vocabulary', async () => {
        const transport = stubTransport(() => Promise.reject(new Error('bridge command not exposed')));

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        // No call reached the engine, so nothing attached: the empty report is
        // the honest one, not an omission.
        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'bridge command not exposed',
            attachedCrumbs: [],
        });
    });

    it('throws on an answer that is no outcome at all, rather than passing it as a result', async () => {
        const transport = stubTransport(() => Promise.resolve({ acceptance: 'accepted', application: 'maybe' }));

        await expect(createNativeLiveGraphBackend({ transport }).apply(BATCH)).rejects.toThrow(/unknown outcome/u);
    });

    it('throws on a malformed strip report, which is the only channel that says what a strip built', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 1,
                reports: [{ kind: 'track', id: 'audio-1', deviceIds: [7] }],
            })
        );

        await expect(createNativeLiveGraphBackend({ transport }).apply(BATCH)).rejects.toThrow(
            /malformed strip report/u
        );
    });

    it('throws on an applied answer carrying no runtime revision', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({ acceptance: 'accepted', application: 'applied', reports: [] })
        );

        await expect(createNativeLiveGraphBackend({ transport }).apply(BATCH)).rejects.toThrow(
            /malformed runtimeRevision/u
        );
    });

    it('refuses every batch after disposal without touching the transport', async () => {
        const applyGraphCommands = vi.fn().mockResolvedValue({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [],
        });
        const backend = createNativeLiveGraphBackend({ transport: stubTransport(applyGraphCommands) });

        backend.dispose();
        const result = await backend.apply(BATCH);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'backend disposed',
            attachedCrumbs: [],
        });
        expect(applyGraphCommands).not.toHaveBeenCalled();
    });

    describe('sample banks', () => {
        beforeEach(() => {
            registeredNativeSampleBankKeys.clear();
            inFlightNativeSampleBankShipments.clear();
        });

        const BANK_BATCH: AudioGraphCommandBatch = {
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 'audio-1',
                    name: 'Track 1',
                    state: { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                    devices: [
                        {
                            id: 'device-a',
                            name: 'Levain',
                            type: 'levain',
                            bypassed: false,
                            parameterValues: {},
                            sampleBankKey: 'levain:violin-1',
                        },
                    ],
                    honorMuted: true,
                    contributesAudio: true,
                },
            ],
        };

        function bankTransport(calls: string[]): NativeGraphTransport {
            return {
                applyGraphCommands: () => {
                    calls.push('apply_graph_commands');
                    return Promise.resolve({
                        acceptance: 'accepted',
                        application: 'applied',
                        runtimeRevision: 1,
                        reports: [],
                    });
                },
                beginLevainBank: () => {
                    calls.push('begin_levain_bank');
                    return Promise.resolve(null);
                },
                registerLevainSample: () => {
                    calls.push('register_levain_sample');
                    return Promise.resolve(null);
                },
                commitLevainBank: () => {
                    calls.push('commit_levain_bank');
                    return Promise.resolve(null);
                },
                releaseLevainBank: () => Promise.reject(new Error('unexpected release_levain_bank')),
                registerTimelineSample: () => Promise.reject(new Error('unexpected register_timeline_sample')),
                renderGraphOffline: () => Promise.reject(new Error('unexpected render_graph_offline')),
                mapGraphBatch: () => Promise.reject(new Error('unexpected map_graph_batch')),
            };
        }

        // The engine refuses a Levain device whose bank is not committed yet,
        // and that refusal takes the whole batch — every other strip in the
        // play with it. So the stage is not merely present, it is *before*.
        it('commits a device bank before the batch that maps the device', async () => {
            const calls: string[] = [];

            await createNativeLiveGraphBackend({
                transport: bankTransport(calls),
                acquireNativeSampleBank: () =>
                    Promise.resolve({
                        bank: {
                            instrumentId: 'violin-1',
                            numArticulations: 1,
                            numMics: 1,
                            zones: [],
                            legatoTransitions: [],
                            samples: [
                                {
                                    sampleId: '0',
                                    sampleRate: 48_000,
                                    channels: 1,
                                    frameCount: 1,
                                    pcm: new Uint8Array([1, 2, 3, 4]),
                                },
                            ],
                        },
                        release: vi.fn(),
                    }),
            }).apply(BANK_BATCH);

            expect(calls).toEqual([
                'begin_levain_bank',
                'register_levain_sample',
                'commit_levain_bank',
                'apply_graph_commands',
            ]);
        });

        it('still applies the batch when a bank could not be staged', async () => {
            const calls: string[] = [];

            const result = await createNativeLiveGraphBackend({
                transport: bankTransport(calls),
                acquireNativeSampleBank: () => Promise.reject(new Error('manifest 404')),
            }).apply(BANK_BATCH);

            // One instrument that did not load is one device the engine refuses
            // by name, not a play gesture that refused the whole project.
            expect(calls).toEqual(['apply_graph_commands']);
            expect(result.acceptance).toBe('accepted');
        });

        it('stages nothing when the caller registered no bank door', async () => {
            const calls: string[] = [];

            await createNativeLiveGraphBackend({ transport: bankTransport(calls) }).apply(BANK_BATCH);

            expect(calls).toEqual(['apply_graph_commands']);
        });
    });
});

/** A replaceTopology batch naming one bank on one device, for the claim cases below. */
function claimBatch(bankKey: string): AudioGraphCommandBatch {
    return {
        schemaVersion: 1,
        replaceTopology: true,
        commands: [
            {
                kind: 'create-track-strip',
                trackId: 'audio-1',
                name: 'Track 1',
                state: { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                devices: [
                    {
                        id: 'device-a',
                        name: 'Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                        sampleBankKey: bankKey,
                    },
                ],
                honorMuted: true,
                contributesAudio: true,
            },
        ],
    };
}

function claimTransport(calls: string[]): NativeGraphTransport {
    return {
        applyGraphCommands: () => {
            calls.push('apply_graph_commands');
            return Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 1,
                reports: [],
            });
        },
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
        mapGraphBatch: () => Promise.reject(new Error('unexpected map_graph_batch')),
    };
}

function acquireViolinBank() {
    return Promise.resolve({
        bank: {
            instrumentId: 'violin-1',
            numArticulations: 1,
            numMics: 1,
            zones: [],
            legatoTransitions: [],
            samples: [{ sampleId: '0', sampleRate: 48_000, channels: 1, frameCount: 1, pcm: new Uint8Array([1, 2, 3, 4]) }],
        },
        release: vi.fn(),
    });
}

describe('createNativeLiveGraphBackend — claims scoped per instance (#4203)', () => {
    beforeEach(() => {
        registeredNativeSampleBankKeys.clear();
        inFlightNativeSampleBankShipments.clear();
        claimedNativeSampleBankKeysByBackend.clear();
    });

    // A held instrument can swap live backends mid-roll (#4203): two
    // instances of this same implementation can be staging and disposing
    // concurrently. Claiming under the shared `NATIVE_LIVE_BACKEND_ID` would
    // let one instance's dispose erase every instance's claim, including one
    // a sibling instance still relies on to keep its bank alive.
    it('keeps a bank claimed by a second live instance alive after the first disposes', async () => {
        const calls: string[] = [];
        const transport = claimTransport(calls);

        const backendA = createNativeLiveGraphBackend({ transport, acquireNativeSampleBank: acquireViolinBank });
        await backendA.apply(claimBatch('levain:violin-1'));

        const backendB = createNativeLiveGraphBackend({ transport, acquireNativeSampleBank: acquireViolinBank });
        await backendB.apply(claimBatch('levain:violin-1'));

        backendA.dispose();

        // A foreign backend's replaceTopology naming nothing runs the release
        // pass: it must still find the bank claimed by backend B.
        await registerNativeSampleBanks({
            transport,
            commands: [],
            acquire: acquireViolinBank,
            replaceTopology: true,
            backendId: 'foreign',
        });

        expect(calls.filter((call) => call.startsWith('release:'))).not.toContain('release:levain:violin-1');
        expect(registeredNativeSampleBankKeys.has('levain:violin-1')).toBe(true);
    });
});
