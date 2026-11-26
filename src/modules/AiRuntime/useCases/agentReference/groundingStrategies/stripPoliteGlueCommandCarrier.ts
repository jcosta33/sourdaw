import { getPoliteCommandPrefixLength } from './getPoliteCommandPrefixLength';

export function stripPoliteGlueCommandCarrier(text: string): string {
    const trimmed = text.trim();
    const commandSource = trimmed.slice(getPoliteCommandPrefixLength(trimmed));
    return commandSource.replace(/\s+(?:please|thanks|thank you)[.!?]*\s*$/iu, '');
}
