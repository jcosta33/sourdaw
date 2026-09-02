const universalTrackControlIntentPattern = /\b(?:mute|unmute|solo|unsolo)\s+all(?:\s+\p{L}+)?\s+tracks\b/giu;

export function getUniversalTrackControlIntentPhrases(prompt: string): readonly string[] {
    return [...prompt.matchAll(universalTrackControlIntentPattern)].map((match) => match[0]);
}
