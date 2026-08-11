import { arpeggiate, restoreMidiClipNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

type ArpPattern = Parameters<typeof arpeggiate>[1];
type ArpRate = Parameters<typeof arpeggiate>[2];

type ArpeggiateAction = Extract<AppAction, { type: 'arpeggiate' }>;

function getGuardedArpeggio(action: ArpeggiateAction) {
    const { addedNotes, clipName, expectedClipLocked, expectedNotes, expectedTrackFrozen, expectedTrackId, trackName } =
        action.payload;
    if (
        !addedNotes ||
        clipName === undefined ||
        expectedClipLocked === undefined ||
        !expectedNotes ||
        expectedTrackFrozen === undefined ||
        !expectedTrackId ||
        trackName === undefined
    ) {
        return null;
    }
    const replacementNotes = [...expectedNotes, ...addedNotes];
    const replayGuard = {
        trackId: expectedTrackId,
        expectedTrackFrozen,
        expectedClipLocked,
    };
    return { addedNotes, clipName, expectedNotes, replacementNotes, replayGuard, trackName };
}

export const handleArpeggiate = createHandler<'arpeggiate'>({
    execute: (alpha) => {
        const guarded = getGuardedArpeggio(alpha);
        if (guarded) {
            return {
                status: restoreMidiClipNotes({
                    clipId: alpha.payload.clipId,
                    notes: guarded.replacementNotes,
                    expectedNotes: guarded.expectedNotes,
                    noteTransformReplayGuard: guarded.replayGuard,
                }),
            };
        }
        arpeggiate(
            alpha.payload.clipId,
            (alpha.payload.pattern as ArpPattern) ?? 'up',
            (alpha.payload.rate as ArpRate) ?? 16,
            alpha.payload.octaves ?? 1,
            alpha.payload.gate ?? 80
        );
        return { status: 'written' };
    },
    describe: (alpha) => {
        const guarded = getGuardedArpeggio(alpha);
        if (!guarded) {
            return { label: `Arpeggiate (${alpha.payload.pattern ?? 'up'})` };
        }
        const label = `Track "${guarded.trackName}" (${guarded.replayGuard.trackId}), clip "${guarded.clipName}" (${alpha.payload.clipId}): add ${String(guarded.addedNotes.length)} syncopated offbeat eighth-note arpeggio notes; preserve ${String(guarded.expectedNotes.length)} source notes, absolute voicing, velocities, expression, and harmonic boundaries`;
        return {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: alpha.payload.clipId,
                    notes: guarded.expectedNotes,
                    expectedNotes: guarded.replacementNotes,
                    noteTransformReplayGuard: guarded.replayGuard,
                },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: alpha.payload.clipId,
                    notes: guarded.replacementNotes,
                    expectedNotes: guarded.expectedNotes,
                    noteTransformReplayGuard: guarded.replayGuard,
                },
            },
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
