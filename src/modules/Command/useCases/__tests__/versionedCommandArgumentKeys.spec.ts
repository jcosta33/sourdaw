import { describe, expect, it } from 'vitest';

import {
    type ClipSatelliteEntrySnapshot,
    type ClipSplitActionSnapshot,
    type ClipStateSnapshot,
    type MidiClipDataActionSnapshot,
    type RetiredTakeLaneSnapshot,
} from '#/utils/handlerContract';

import { validateVersionedCommandArguments } from '../versionedCommandArgumentKeys';

// The fixtures mirror the producer shapes `prepareClipSplit` writes — the undo's
// `replacement` carries `rightClip: null`, the right clip always carries the
// offset fields, and every snapshot carries both satellite entries and the
// automation-lane array — because a decode guard that omits what the producer
// always writes pins a shape reality never produces.
function makeClipSnapshot(id: string): ClipStateSnapshot {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
}

const emptyMidi: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function makeSnapshot(overrides: Partial<ClipSplitActionSnapshot> = {}): ClipSplitActionSnapshot {
    return {
        trackId: 't1',
        leftClip: makeClipSnapshot('c1'),
        rightClip: makeClipSnapshot('c2'),
        rightClipIndex: 1,
        sourceMidi: emptyMidi,
        rightMidi: emptyMidi,
        clipSatellites: [
            { clipId: 'c1', gainEnvelope: null, warpState: null },
            { clipId: 'c2', gainEnvelope: null, warpState: null },
        ],
        clipAutomationLanes: [],
        ...overrides,
    };
}

describe('versionedCommandArgumentKeys — restoreClipSplitState (#4521)', () => {
    it('decodes a payload carrying retiredTakeLanes, and a legacy payload without it', () => {
        const retiredTakeLanes: RetiredTakeLaneSnapshot[] = [
            {
                lane: { id: 'lane-1', trackId: 't1', takes: [], activeCompRegions: [] },
                laneIndex: 0,
                retiredTakeIds: ['take-1'],
            },
        ];
        const withField = {
            clipId: 'c1',
            rightClipId: 'c2',
            expected: makeSnapshot(),
            replacement: makeSnapshot({ rightClip: null }),
            retiredTakeLanes,
        };
        expect(validateVersionedCommandArguments('restoreClipSplitState', withField)).toBe(true);

        // Entries persisted before the field existed must still decode, or a
        // reload drops the split from history.
        const legacy = {
            clipId: 'c1',
            rightClipId: 'c2',
            expected: makeSnapshot(),
            replacement: makeSnapshot({ rightClip: null }),
        };
        expect(validateVersionedCommandArguments('restoreClipSplitState', legacy)).toBe(true);
    });

    it('validates a warp satellite carrying a pre-ADR stretch mode a previous build recorded', () => {
        // Envelopes recorded before the ADR 0024 retirement hold the legacy ids
        // their build's snapshots carried; the wire union must keep admitting
        // them or recovery refuses the whole continuation. The satellite store
        // decodes the id onto the canonical set at the write boundary — see the
        // clipSatelliteState spec.
        const legacyWarpSatellites: ClipSatelliteEntrySnapshot[] = [
            {
                clipId: 'c1',
                gainEnvelope: null,
                warpState: { enabled: true, markers: [], stretchMode: 'complex', originalTempo: 120 },
            },
            { clipId: 'c2', gainEnvelope: null, warpState: null },
        ];
        const legacyPayload = {
            clipId: 'c1',
            rightClipId: 'c2',
            expected: makeSnapshot({ clipSatellites: legacyWarpSatellites }),
            replacement: makeSnapshot({ rightClip: null, clipSatellites: legacyWarpSatellites }),
        };
        expect(validateVersionedCommandArguments('restoreClipSplitState', legacyPayload)).toBe(true);
    });
});

describe('versionedCommandArgumentKeys — dense array admission (#4938)', () => {
    // Assigning past the end leaves the skipped indices as holes; Array.prototype.every
    // would visit only the populated slots and admit the array.
    it('refuses a marquee selection whose trackIds carry a hole', () => {
        const trackIds: string[] = ['t1'];
        trackIds[2] = 't3';
        expect(
            validateVersionedCommandArguments('setMarqueeSelection', {
                selection: { startBeat: 0, endBeat: 4, trackIds },
            })
        ).toBe(false);
        expect(
            validateVersionedCommandArguments('setMarqueeSelection', {
                selection: { startBeat: 0, endBeat: 4, trackIds: ['t1', 't2', 't3'] },
            })
        ).toBe(true);
    });

    it('refuses a device state whose json-safe payload array carries a hole', () => {
        const chunk: unknown[] = [{ gain: 1 }];
        chunk[2] = null;
        expect(
            validateVersionedCommandArguments('setDeviceState', {
                deviceId: 'device-1',
                state: { version: 1, data: { chunk } },
            })
        ).toBe(false);
        expect(
            validateVersionedCommandArguments('setDeviceState', {
                deviceId: 'device-1',
                state: { version: 1, data: { chunk: [{ gain: 1 }, null, null] } },
            })
        ).toBe(true);
    });

    it('refuses a time-signature tuple carrying a hole', () => {
        const expectedTimeSignature: number[] = [3];
        expectedTimeSignature.length = 2;
        expect(
            validateVersionedCommandArguments('automateSendRanges', {
                trackIds: ['t1'],
                busId: 'bus-1',
                sectionIds: ['s1'],
                tailBars: 1,
                targetLevelDb: -6,
                expectedTimeSignature,
            })
        ).toBe(false);
        expect(
            validateVersionedCommandArguments('automateSendRanges', {
                trackIds: ['t1'],
                busId: 'bus-1',
                sectionIds: ['s1'],
                tailBars: 1,
                targetLevelDb: -6,
                expectedTimeSignature: [3, 4],
            })
        ).toBe(true);
    });
});
