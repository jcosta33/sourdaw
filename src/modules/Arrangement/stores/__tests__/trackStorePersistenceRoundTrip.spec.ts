import { describe, expect, it } from 'vitest';

import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

import { sanitizeTrackSnapshot } from '../trackStore';

/**
 * Persistence integrity: `sanitizeTrackSnapshot` is the CRDT/load projection that
 * rebuilds every track and clip field-by-field. The domain contract is that every
 * valid persisted field survives a save/reload round-trip unchanged, and every
 * malformed field is dropped to a safe default rather than persisted as garbage.
 *
 * These tests exercise the optional-field whitelist branches for clips, devices,
 * sends, midi-fx, freeze state, and track-level fields that the existing specs
 * leave uncovered.
 */

function snapshotWithTrack(track: Record<string, unknown>): Record<string, unknown> {
    return { tracks: [track], selectedTrackId: null };
}

const validClipBase = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip',
    startBeat: 0,
    endBeat: 4,
    type: 'audio' as const,
};

const validDeviceBase = {
    id: 'dev-1',
    name: 'Reverb',
    type: 'reverb',
};

const validSendBase = { busId: 'bus-1' };

const validMidiFxBase = { id: 'fx-1', type: 'arp' };

const validTrackBase = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio' as const,
};

describe('sanitizeTrackSnapshot — clip optional field round-trip', () => {
    it('preserves audio clip source and offset fields through the round-trip', () => {
        const clip = {
            ...validClipBase,
            audioBufferId: 'buf-1',
            assetHash: 'sha-abc',
            audioOffsetBeats: 1.5,
            midiOffsetBeats: 0.25,
        };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        const restored = result.tracks[0]?.clips[0];
        expect(restored?.audioBufferId).toBe('buf-1');
        expect(restored?.assetHash).toBe('sha-abc');
        expect(restored?.audioOffsetBeats).toBe(1.5);
        expect(restored?.midiOffsetBeats).toBe(0.25);
    });

    it.each([
        ['stretchMode', { stretchMode: 'repitch', stretchRatio: 1.2 }, { stretchMode: 'repitch', stretchRatio: 1.2 }],
        ['loopEnabled', { loopEnabled: true, loopLength: 4 }, { loopEnabled: true, loopLength: 4 }],
    ] as const)('preserves clip %s through the round-trip', (_label, fields, expected) => {
        const clip = { ...validClipBase, ...fields };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        const restored = result.tracks[0]?.clips[0];
        expect(restored).toMatchObject(expected);
    });

    it.each([
        ['stop', 'stop'],
        ['play_next', 'play_next'],
        ['play_previous', 'play_previous'],
        ['play_random', 'play_random'],
        ['play_first', 'play_first'],
        ['play_last', 'play_last'],
    ] as const)('preserves a valid followAction %s through the round-trip', (action, expected) => {
        const clip = { ...validClipBase, followAction: action };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        expect(result.tracks[0]?.clips[0]?.followAction).toBe(expected);
    });

    it('drops a non-string audioBufferId rather than persisting garbage', () => {
        const clip = { ...validClipBase, audioBufferId: 123 };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        expect(result.tracks[0]?.clips[0]?.audioBufferId).toBeUndefined();
    });

    it('drops a non-finite stretchRatio rather than persisting garbage', () => {
        const clip = { ...validClipBase, stretchRatio: Number.NaN };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        expect(result.tracks[0]?.clips[0]?.stretchRatio).toBeUndefined();
    });

    it('preserves clip generation and ghost flags used by AI features', () => {
        const clip = {
            ...validClipBase,
            generating: true,
            isGhost: true,
            isInlineEditing: true,
            parentClipId: 'parent-1',
            isLinkedInstance: true,
            sourceKeyRoot: 0,
            sourceScaleName: 'C major',
        };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        const restored = result.tracks[0]?.clips[0];
        expect(restored).toMatchObject({
            generating: true,
            isGhost: true,
            isInlineEditing: true,
            parentClipId: 'parent-1',
            isLinkedInstance: true,
            sourceKeyRoot: 0,
            sourceScaleName: 'C major',
        });
    });

    it('preserves a clip overrides whitelist of boolean flags', () => {
        const clip = { ...validClipBase, overrides: { gain: true, muted: false, pan: true } };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        expect(result.tracks[0]?.clips[0]?.overrides).toEqual({ gain: true, muted: false, pan: true });
    });

    it('drops non-boolean override values from the whitelist', () => {
        const clip = { ...validClipBase, overrides: { gain: 'yes', muted: false } };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, clips: [clip] }));

        expect(result.tracks[0]?.clips[0]?.overrides).toEqual({ muted: false });
    });
});

describe('sanitizeTrackSnapshot — device optional field round-trip', () => {
    it('preserves all external plugin identity fields through the round-trip', () => {
        const device = {
            ...validDeviceBase,
            bypassed: true,
            parameterValues: { mix: 0.5, size: 0.8 },
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
            externalStateChunk: 'chunk-1',
        };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, devices: [device] }));

        expect(result.tracks[0]?.devices[0]).toMatchObject({
            bypassed: true,
            parameterValues: { mix: 0.5, size: 0.8 },
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
            externalStateChunk: 'chunk-1',
        });
    });

    it('defaults bypassed to false and parameterValues to an empty object', () => {
        const device = { ...validDeviceBase };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, devices: [device] }));

        const restored = result.tracks[0]?.devices[0];
        expect(restored?.bypassed).toBe(false);
        expect(restored?.parameterValues).toEqual({});
    });

    it('drops non-finite values from parameterValues', () => {
        const device = { ...validDeviceBase, parameterValues: { mix: 0.5, bad: Number.NaN, size: 'big' } };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, devices: [device] }));

        expect(result.tracks[0]?.devices[0]?.parameterValues).toEqual({ mix: 0.5 });
    });

    it('rejects a device missing its name or type', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                devices: [
                    { id: 'd1', name: 5, type: 'reverb' },
                    { id: 'd2', name: 'Ok', type: 7 },
                ],
            })
        );

        expect(result.tracks[0]?.devices).toEqual([]);
    });
});

describe('sanitizeTrackSnapshot — send round-trip', () => {
    it('preserves a send with level and preFader through the round-trip', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({ ...validTrackBase, sends: [{ ...validSendBase, level: 0.7, preFader: true }] })
        );

        expect(result.tracks[0]?.sends[0]).toEqual({ busId: 'bus-1', level: 0.7, preFader: true });
    });

    it('defaults level to 0 and preFader to false when absent', () => {
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, sends: [{ ...validSendBase }] }));

        expect(result.tracks[0]?.sends[0]).toEqual({ busId: 'bus-1', level: 0, preFader: false });
    });

    it('rejects a send without a busId', () => {
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, sends: [{ level: 0.5 }] }));

        expect(result.tracks[0]?.sends).toEqual([]);
    });
});

describe('sanitizeTrackSnapshot — midi-fx round-trip', () => {
    it.each(['arp', 'velocity', 'probability'] as const)('preserves a %s midi-fx device with parameters', (type) => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                midiFx: [{ id: 'fx-1', type, parameterValues: { rate: 0.5 } }],
            })
        );

        expect(result.tracks[0]?.midiFx?.[0]).toMatchObject({
            id: 'fx-1',
            type,
            parameterValues: { rate: 0.5 },
        });
    });

    it('derives a capitalized name when none is provided', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({ ...validTrackBase, midiFx: [{ ...validMidiFxBase }] })
        );

        expect(result.tracks[0]?.midiFx?.[0]?.name).toBe('Arp');
    });

    it('rejects an unknown midi-fx type', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({ ...validTrackBase, midiFx: [{ id: 'fx-1', type: 'echo' }] })
        );

        expect(result.tracks[0]?.midiFx).toEqual([]);
    });
});

describe('sanitizeTrackSnapshot — freeze state render settings round-trip', () => {
    it('preserves a full freeze render settings object through the round-trip', () => {
        const freezeState = {
            status: 'frozen',
            freezeId: 'freeze-1',
            frozenBufferId: 'buffer-1',
            frozenAudioHash: 'hash-1',
            sourceContentHash: 'src-hash',
            deviceChainHash: 'chain-hash',
            renderProgress: 1,
            errorMessage: '',
            renderedAt: 1234,
            renderSettings: {
                sampleRate: 48000,
                bitDepth: 24,
                channelCount: 2,
                tailLengthSeconds: 3.5,
            },
        };
        const result = sanitizeTrackSnapshot(snapshotWithTrack({ ...validTrackBase, kind: 'audio', freezeState }));

        expect(result.tracks[0]?.freezeState).toEqual(freezeState);
    });

    it('drops renderSettings when any required field is non-finite', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: {
                    status: 'frozen',
                    renderSettings: { sampleRate: 48000, bitDepth: 'big', channelCount: 2, tailLengthSeconds: 1 },
                },
            })
        );

        expect(result.tracks[0]?.freezeState?.renderSettings).toBeUndefined();
    });

    it('keeps the freeze row but drops renderSettings when the object itself is malformed', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: { status: 'frozen', renderSettings: 'not-an-object' },
            })
        );

        expect(result.tracks[0]?.freezeState?.status).toBe('frozen');
        expect(result.tracks[0]?.freezeState?.renderSettings).toBeUndefined();
    });

    /**
     * `bakeVersion` is what tells staleness detection that a buffer was printed
     * under the current freeze rules. If the projection drops it, a correctly
     * frozen track reads as older than the current version on every reload and
     * is marked `stale` — freeze silently undoes itself on project open, and the
     * track falls back to the live device chain the freeze existed to replace.
     */
    it('preserves bakeVersion through the round-trip so a current freeze does not read as legacy', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: {
                    status: 'frozen',
                    renderSettings: {
                        sampleRate: 48000,
                        bitDepth: 32,
                        channelCount: 2,
                        tailLengthSeconds: 3.5,
                        bakeVersion: FREEZE_BAKE_VERSION,
                    },
                },
            })
        );

        expect(result.tracks[0]?.freezeState?.renderSettings?.bakeVersion).toBe(FREEZE_BAKE_VERSION);
    });

    it('leaves bakeVersion absent for a legacy buffer rather than inventing a version', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: {
                    status: 'frozen',
                    renderSettings: { sampleRate: 48000, bitDepth: 32, channelCount: 2, tailLengthSeconds: 3.5 },
                },
            })
        );

        const restored = result.tracks[0]?.freezeState?.renderSettings;
        expect(restored?.tailLengthSeconds).toBe(3.5);
        expect(restored?.bakeVersion).toBeUndefined();
    });

    it('drops a non-numeric bakeVersion but keeps the render settings it travelled with', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: {
                    status: 'frozen',
                    renderSettings: {
                        sampleRate: 48000,
                        bitDepth: 32,
                        channelCount: 2,
                        tailLengthSeconds: 3.5,
                        bakeVersion: 'one',
                    },
                },
            })
        );

        const restored = result.tracks[0]?.freezeState?.renderSettings;
        expect(restored?.sampleRate).toBe(48000);
        expect(restored?.bakeVersion).toBeUndefined();
    });

    /**
     * `compensationSeconds` is the plugin-delay figure the chain carried at the
     * moment the buffer was printed, and it is the only one that matches the
     * buffer's content. `scheduleFrozenTrack` falls back to the *live* chain's
     * current latency when it is absent — a fallback its comment scopes to
     * buffers frozen before the field existed. Dropping the field in the
     * projection puts every reloaded track on that legacy path, and since a
     * plugin latency change never marks a frozen track stale, the resulting
     * drift is silent and never self-corrects.
     */
    it('preserves compensationSeconds through the round-trip so playback shifts by the baked figure', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: { status: 'frozen', compensationSeconds: 0.032 },
            })
        );

        expect(result.tracks[0]?.freezeState?.compensationSeconds).toBe(0.032);
    });

    it('leaves compensationSeconds absent for a buffer frozen before the field existed', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({ ...validTrackBase, freezeState: { status: 'frozen' } })
        );

        expect(result.tracks[0]?.freezeState?.compensationSeconds).toBeUndefined();
    });

    it('drops a non-numeric compensationSeconds rather than persisting it as garbage', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: { status: 'frozen', compensationSeconds: 'late' },
            })
        );

        expect(result.tracks[0]?.freezeState?.status).toBe('frozen');
        expect(result.tracks[0]?.freezeState?.compensationSeconds).toBeUndefined();
    });

    /**
     * A negative compensation does not merely shift playback the wrong way, it
     * silences the track. `scheduleFrozenTrack` computes
     * `startTime = now + offset + compensation`, so a negative value puts
     * `startTime` behind `now`; once the resulting `elapsed` passes the buffer
     * duration the function returns `true` without ever starting a source, and
     * the caller reads that as handled and skips live scheduling too.
     *
     * `is_finite_number` does not look at sign — the same gap this branch
     * already closed for `tailLengthSeconds`, where `resolveFrozenBufferTail`
     * routes a negative to unknown rather than laundering it to a trusted zero.
     * The rule belongs on every field it applies to, not only the one that
     * happened to be under the microscope.
     */
    it('drops a negative compensationSeconds, which would silence the track rather than shift it', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: { status: 'frozen', compensationSeconds: -0.032 },
            })
        );

        expect(result.tracks[0]?.freezeState?.status).toBe('frozen');
        expect(result.tracks[0]?.freezeState?.compensationSeconds).toBeUndefined();
    });

    /**
     * Zero is the legitimate value for the highest-latency track in a project —
     * `getCompensationDelay` returns `(max - own) / 1000`. It must survive, and
     * it must not be confused with absent: `scheduleFrozenTrack` uses `??`, so
     * absent falls back to the live chain while `0` correctly means no shift.
     */
    it('keeps a zero compensationSeconds, which is the highest-latency track s real value', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                freezeState: { status: 'frozen', compensationSeconds: 0 },
            })
        );

        expect(result.tracks[0]?.freezeState?.compensationSeconds).toBe(0);
    });
});

describe('sanitizeTrackSnapshot — track-level optional field round-trip', () => {
    it('preserves the full track mixer and routing surface through the round-trip', () => {
        const track = {
            ...validTrackBase,
            muted: true,
            soloed: true,
            armed: true,
            gain: 0.9,
            pan: -0.25,
            color: '#00ff00',
            collapsed: true,
            inputMonitoring: 'on',
            hidden: true,
            disabled: true,
            height: 120,
            outputId: 'bus-1',
            automationMode: 'touch',
            groupId: 'group-1',
            soloSafe: true,
            notes: 'Lead vocal',
            inputId: 'input-1',
            vcaGroupId: 'vca-1',
            midiOutputTrackId: 'midi-1',
            followChordTrack: true,
            showVariationLanes: true,
        };
        const result = sanitizeTrackSnapshot(snapshotWithTrack(track));

        expect(result.tracks[0]).toMatchObject({
            muted: true,
            soloed: true,
            armed: true,
            gain: 0.9,
            pan: -0.25,
            color: '#00ff00',
            collapsed: true,
            inputMonitoring: 'on',
            hidden: true,
            disabled: true,
            height: 120,
            outputId: 'bus-1',
            automationMode: 'touch',
            groupId: 'group-1',
            soloSafe: true,
            notes: 'Lead vocal',
            inputId: 'input-1',
            vcaGroupId: 'vca-1',
            midiOutputTrackId: 'midi-1',
            followChordTrack: true,
            showVariationLanes: true,
        });
    });

    it('preserves alternatives with their nested clips through the round-trip', () => {
        const track = {
            ...validTrackBase,
            activeAlternativeId: 'alt-1',
            alternatives: [
                {
                    id: 'alt-1',
                    name: 'Take B',
                    clips: [{ ...validClipBase, id: 'alt-clip-1', name: 'Alt Clip' }],
                },
            ],
        };
        const result = sanitizeTrackSnapshot(snapshotWithTrack(track));

        const alt = result.tracks[0]?.alternatives?.[0];
        expect(alt?.id).toBe('alt-1');
        expect(alt?.name).toBe('Take B');
        expect(alt?.clips[0]?.id).toBe('alt-clip-1');
        expect(result.tracks[0]?.activeAlternativeId).toBe('alt-1');
    });

    it('rejects an alternative missing its id', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithTrack({
                ...validTrackBase,
                alternatives: [{ name: 'No Id', clips: [] }],
            })
        );

        expect(result.tracks[0]?.alternatives).toEqual([]);
    });
});
