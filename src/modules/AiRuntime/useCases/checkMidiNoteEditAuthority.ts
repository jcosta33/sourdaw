import { musicalContentBindingIsCurrent } from '#/modules/Project/useCases';

import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { type createMusicalReadPrerequisite } from './createMusicalReadPrerequisite';

type MidiReadProof = NonNullable<
    ReturnType<NonNullable<ReturnType<typeof createMusicalReadPrerequisite>>['completed']>
>;

function hasSelectedWindows(proof: MidiReadProof, clipId: string): boolean {
    return (
        proof.windows.length > 0 &&
        proof.windows.every((window) => window.clipId === clipId && window.owners.length > 0)
    );
}

function matchesAuthorityRevision(
    authority: CreativeRequestAuthority,
    proof: MidiReadProof,
    revision: string
): boolean {
    return (
        authority.mode === 'edit' &&
        authority.revision === revision &&
        proof.binding.expectedRevision === revision &&
        proof.authorityId === authority.authorityId
    );
}

function readPermittedClipTarget(authority: CreativeRequestAuthority, clipId: string) {
    const target = authority.targets[0];
    if (
        authority.targets.length !== 1 ||
        target?.objectType !== 'clip' ||
        target.objectIds.length !== 1 ||
        target.objectIds[0] !== clipId ||
        !target.parentTrackId ||
        !['explicit-reference', 'contextual-selection'].includes(target.provenance) ||
        authority.prohibitions.some((prohibition) => {
            if (prohibition.kind === 'exclude-dimension') {
                return prohibition.dimension === 'midi-content';
            }
            return prohibition.objectId === clipId || prohibition.objectId === target.parentTrackId;
        })
    ) {
        return null;
    }
    return { trackId: target.parentTrackId };
}

export function checkMidiNoteEditAuthority(input: {
    call: ToolCallResult;
    proof?: MidiReadProof;
    authority?: CreativeRequestAuthority;
    revision: string | undefined;
}) {
    const { call, authority, proof, revision } = input;
    const clipId = call.arguments.clipId;
    if (
        !proof ||
        !authority ||
        !revision ||
        !matchesAuthorityRevision(authority, proof, revision) ||
        !authority.editDimensions.includes('midi-content') ||
        !musicalContentBindingIsCurrent(proof.binding) ||
        typeof clipId !== 'string'
    ) {
        return null;
    }
    if (!hasSelectedWindows(proof, clipId)) {
        return null;
    }
    const target = readPermittedClipTarget(authority, clipId);
    if (!target) {
        return null;
    }
    return { clipId, trackId: target.trackId, authority, proof };
}
