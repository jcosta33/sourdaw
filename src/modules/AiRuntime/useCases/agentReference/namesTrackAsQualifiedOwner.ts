import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';

function containsQualifiedTrackOwnerReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeAgentReferenceText(prompt)} `;
    const normalizedReference = normalizeAgentReferenceText(reference);
    return [
        ` on ${normalizedReference} `,
        ` on the ${normalizedReference} `,
        ` in ${normalizedReference} `,
        ` in the ${normalizedReference} `,
        ` from ${normalizedReference} `,
        ` from the ${normalizedReference} `,
    ].some((qualifiedReference) => normalizedPrompt.includes(qualifiedReference));
}

export function namesTrackAsQualifiedOwner(prompt: string, track: { id: string; name: string }): boolean {
    return (
        containsQualifiedTrackOwnerReference(prompt, track.id) ||
        containsQualifiedTrackOwnerReference(prompt, track.name)
    );
}
