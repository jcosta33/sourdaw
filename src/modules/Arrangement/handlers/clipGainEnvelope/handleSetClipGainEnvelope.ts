import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type ClipGainEnvelope, getEnvelope, removeEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';

type SetClipGainEnvelopeAction = Extract<AppAction, { type: 'setClipGainEnvelope' }>;

/** The contract's snapshot shape holds a readonly points array; the store's
 *  envelope holds a mutable one, so thaw copies the array (the point objects
 *  themselves are scalar-keyed and never mutated in place). */
function thawEnvelope(snapshot: Exclude<SetClipGainEnvelopeAction['payload']['envelope'], null>): ClipGainEnvelope {
    return {
        clipId: snapshot.clipId,
        enabled: snapshot.enabled,
        points: Array.from(snapshot.points),
    };
}

/**
 * The whole-envelope companion write. User surfaces edit envelopes through the
 * toggle/add/remove/reset actions; this action exists so those actions'
 * inverses can restore the exact prior envelope — including the cases a
 * point-level inverse cannot express (a removal that triggered the "never zero
 * points" substitution, or an edit that first created the envelope).
 */
export const handleSetClipGainEnvelope = createHandler<'setClipGainEnvelope'>({
    execute: (action) => {
        if (action.payload.envelope === null) {
            const existed = getEnvelope(action.payload.clipId) !== undefined;
            removeEnvelope(action.payload.clipId);
            return existed ? undefined : { status: 'no-write' };
        }
        setEnvelope(action.payload.clipId, thawEnvelope(action.payload.envelope));
        return undefined;
    },
    describe: (action) => {
        const prev = getEnvelope(action.payload.clipId);
        return {
            label:
                prev === undefined
                    ? `Remove the gain envelope of clip ${action.payload.clipId}`
                    : `Restore the gain envelope of clip ${action.payload.clipId}`,
            inverseAction: {
                type: 'setClipGainEnvelope',
                payload: { clipId: action.payload.clipId, envelope: prev ?? null },
            },
        };
    },
    undoable: true,
});
