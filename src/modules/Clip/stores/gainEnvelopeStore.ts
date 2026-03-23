/**
 * In-memory store for clip gain envelopes, keyed by clipId.
 */

export type GainEnvelopePoint = {
    id: string;
    beatOffset: number; // relative to clip start
    gainDb: number; // -inf to +12 dB
};

export type ClipGainEnvelope = {
    clipId: string;
    points: GainEnvelopePoint[];
    enabled: boolean;
};

export const gainEnvelopeStore = new Map<string, ClipGainEnvelope>();
