import { describe, expect, it } from 'vitest';

import {
    type ClipSplitActionSnapshot,
    type ClipStateSnapshot,
    type MidiClipDataActionSnapshot,
    type RetiredTakeLaneSnapshot,
} from '#/utils/handlerContract';

import { validateVersionedCommandArguments } from '../versionedCommandArgumentKeys';

// The fixtures mirror the producer shapes `prepareClipSplit` writes — the undo's
// `replacement` carries `rightClip: null` — and the Arrangement handler specs'
// snapshots, which the restore handler consumes.
function makeClipSnapshot(id: string): ClipStateSnapshot {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
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
});
