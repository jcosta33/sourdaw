import { type LoopSlot } from '../../stores/loopStationStore';

/**
 * Formats a beat position as `"<bar>.<beat>"`. Extracted from
 * `LoopStationPanel` (F10) so `formatLoopProgress` — the one function whose
 * call count actually scales with per-frame ticking — can be spied on from a
 * test without spying on the whole panel module.
 */
export function formatBarBeat(positionBeats: number, numerator: number): string {
    if (numerator <= 0) {
        return '1.1';
    }
    const safeBeat = Math.max(0, positionBeats);
    const bar = Math.floor(safeBeat / numerator) + 1;
    const beat = Math.floor(safeBeat % numerator) + 1;
    return `${bar}.${beat}`;
}

/** Formats a loop slot's playhead position relative to its own loop length. */
export function formatLoopProgress(slot: LoopSlot, positionBeats: number, numerator: number): string {
    if (slot.lengthBeats <= 0) {
        return `—`;
    }
    const localBeat = ((positionBeats % slot.lengthBeats) + slot.lengthBeats) % slot.lengthBeats;
    return formatBarBeat(localBeat, numerator);
}
