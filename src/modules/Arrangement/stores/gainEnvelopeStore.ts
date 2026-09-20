/**
 * Clip gain envelope store.
 *
 * §197.1 — previously a bare module-level \`Map<string, ClipGainEnvelope>\`
 * with no subscription mechanism, forcing the inspector panel to use a
 * local \`envKey\` counter that only tracked in-component mutations (undo,
 * redo, collab sync, and external actions all left the UI stale). Now a
 * proper \`Store<Record<clipId, ClipGainEnvelope>>\` that components can
 * subscribe to via \`useStore\`.
 */
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type GainEnvelopePoint = {
    id: string;
    /** Relative to clip start. */
    beatOffset: number;
    /** -inf to +12 dB. */
    gainDb: number;
};

export type ClipGainEnvelope = {
    clipId: string;
    points: GainEnvelopePoint[];
    enabled: boolean;
};

export type GainEnvelopeStoreState = {
    envelopes: Record<string, ClipGainEnvelope>;
};

export const defaultGainEnvelopeStoreState: GainEnvelopeStoreState = { envelopes: {} };

// ── Imperative helpers (kept so callers that mutate via the use cases
// ── don't need to each know how to read/write the store shape) ────────

export function getEnvelope(clipId: string): ClipGainEnvelope | undefined {
    return gainEnvelopeStore.value?.envelopes[clipId];
}

export function setEnvelope(clipId: string, envelope: ClipGainEnvelope): void {
    const current = gainEnvelopeStore.value ?? defaultGainEnvelopeStoreState;
    gainEnvelopeStore.set({
        envelopes: { ...current.envelopes, [clipId]: envelope },
    });
}

export function getAllEnvelopes(): ClipGainEnvelope[] {
    const current = gainEnvelopeStore.value;
    if (!current) {
        return [];
    }
    return Object.values(current.envelopes);
}

/** Replace every envelope at once — the project-load entry point. */
export function setAllEnvelopes(envelopes: Record<string, ClipGainEnvelope>): void {
    gainEnvelopeStore.set({ envelopes });
}

// ── Curve reads ─────────────────────────────────────────────────────────
//
// The curve law lives here rather than beside `sampleGainEnvelopePoints`
// because both audio carriers must read it: the live Web Audio scheduler
// (Transport) reaches this store through the Arrangement stores barrel, and
// the offline renderer (AudioEngine) may not import the Arrangement useCases
// barrel at all — that edge is the one that closes the module cycle
// `scheduleTrackClips` documents. `sampleGainEnvelopePoints` delegates to this
// walk so there is one law, not two that agree today.

/** One breakpoint of an envelope curve: where it sits, and what it holds. */
export type GainEnvelopeSeriesPoint = Readonly<{
    /** Relative to clip start, on the same axis as {@link GainEnvelopePoint.beatOffset}. */
    beatOffset: number;
    gainDb: number;
}>;

/**
 * The envelope's value at one beat, on the same law the curve reads anywhere:
 * constant at the edge values outside the point range, linear in dB between
 * adjacent points.
 *
 * Points arrive ascending in `beatOffset` — every write path keeps them sorted
 * (`addGainEnvelopePoint` inserts in order, `moveGainEnvelopePoint` re-sorts) —
 * and the segment scan walks them in array order, exactly as
 * `sampleGainEnvelopePoints` always has.
 */
function sampleGainEnvelopeAtBeat(points: readonly GainEnvelopePoint[], beatOffset: number): number {
    if (beatOffset <= points[0]!.beatOffset) {
        return points[0]!.gainDb;
    }

    const lastPoint = points[points.length - 1]!;
    if (beatOffset >= lastPoint.beatOffset) {
        return lastPoint.gainDb;
    }

    for (let index = 0; index < points.length - 1; index++) {
        const alpha = points[index]!;
        const beta = points[index + 1]!;
        if (beatOffset >= alpha.beatOffset && beatOffset <= beta.beatOffset) {
            const span = beta.beatOffset - alpha.beatOffset;
            const time = (beatOffset - alpha.beatOffset) / span;
            return alpha.gainDb + time * (beta.gainDb - alpha.gainDb);
        }
    }

    return 0;
}

/**
 * The envelope curve over one span, as the breakpoints a ramp series needs:
 * the sampled value at the span's start, every point strictly inside it, and
 * the sampled value at its end. A renderer maps these beats onto its own clock
 * and ramps between them, so what it plays is the curve the inspector drew
 * rather than one sample of it.
 *
 * `sampleGainEnvelopePoints` is this at a zero-width span — the law is stated
 * once, here, and the two are pinned together by spec.
 */
export function sampleGainEnvelopeSeries(
    points: readonly GainEnvelopePoint[],
    spanStartBeats: number,
    spanEndBeats: number
): readonly GainEnvelopeSeriesPoint[] {
    const startGainDb = sampleGainEnvelopeAtBeat(points, spanStartBeats);
    const series: GainEnvelopeSeriesPoint[] = [{ beatOffset: spanStartBeats, gainDb: startGainDb }];

    for (const point of points) {
        if (point.beatOffset > spanStartBeats && point.beatOffset < spanEndBeats) {
            series.push({ beatOffset: point.beatOffset, gainDb: point.gainDb });
        }
    }

    if (spanEndBeats > spanStartBeats) {
        series.push({ beatOffset: spanEndBeats, gainDb: sampleGainEnvelopeAtBeat(points, spanEndBeats) });
    }

    return series;
}

/**
 * The envelope a renderer should schedule, or `undefined` when the clip
 * carries none that changes what it sounds like.
 *
 * An envelope that is absent, disabled, or whose every point holds `0 dB` is
 * provably a no-op — the curve is the constant-edge interpolation of its
 * points, so all-zero points can only read zero.
 */
function activeEnvelopeFor(
    clipId: string,
    envelopes = gainEnvelopeStore.value?.envelopes
): ClipGainEnvelope | undefined {
    const envelope = envelopes?.[clipId];
    if (!envelope || !envelope.enabled) {
        return undefined;
    }
    return envelope.points.some((point) => point.gainDb !== 0) ? envelope : undefined;
}

/**
 * Whether a clip carries an envelope that changes what it sounds like.
 *
 * Callers use this both to skip scheduling a gain node nothing will move and
 * to keep an envelope-carrying clip off a carrier that cannot apply the
 * curve (#2865).
 */
export function clipHasActiveGainEnvelope(clipId: string, envelopes?: GainEnvelopeStoreState['envelopes']): boolean {
    return activeEnvelopeFor(clipId, envelopes) !== undefined;
}

/**
 * The enabled envelope's curve over one beat span, or `undefined` when the
 * clip carries no envelope that changes what it sounds like over that span.
 *
 * The span is iteration-relative, exactly the axis the scheduler samples on:
 * envelope offsets are clip-relative beats, so iteration `n` of a looped clip
 * reads the range `[n * loopLength, … + iterationLength]`.
 */
export function getGainEnvelopeSeries(
    clipId: string,
    spanStartBeats: number,
    spanEndBeats: number,
    envelopes?: GainEnvelopeStoreState['envelopes']
): readonly GainEnvelopeSeriesPoint[] | undefined {
    const envelope = activeEnvelopeFor(clipId, envelopes);
    if (!envelope) {
        return undefined;
    }
    return sampleGainEnvelopeSeries(envelope.points, spanStartBeats, spanEndBeats);
}

function isGainEnvelopePoint(value: unknown): value is GainEnvelopePoint {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string') {
        return false;
    }
    if (!('beatOffset' in value) || typeof value.beatOffset !== 'number' || !Number.isFinite(value.beatOffset)) {
        return false;
    }
    return 'gainDb' in value && typeof value.gainDb === 'number' && Number.isFinite(value.gainDb);
}

function isClipGainEnvelope(value: unknown): value is ClipGainEnvelope {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('clipId' in value) || typeof value.clipId !== 'string' || value.clipId.length === 0) {
        return false;
    }
    if (!('enabled' in value) || typeof value.enabled !== 'boolean') {
        return false;
    }
    if (!('points' in value) || !Array.isArray(value.points)) {
        return false;
    }
    return value.points.every(isGainEnvelopePoint);
}

const GAIN_ENVELOPE_POINT_KEYS = ['id', 'beatOffset', 'gainDb'] as const;
const CLIP_GAIN_ENVELOPE_KEYS = ['clipId', 'points', 'enabled'] as const;

/**
 * Decode persisted clip gain envelopes from a project file into the store's
 * `clipId`-keyed shape. An envelope that does not decode is dropped: the clip
 * then plays at its own clip gain, which is what a clip with no envelope does.
 */
export function sanitizeClipGainEnvelopes(value: unknown): Record<string, ClipGainEnvelope> {
    if (!Array.isArray(value)) {
        return {};
    }

    const envelopes: Record<string, ClipGainEnvelope> = {};
    for (const candidate of value) {
        if (!isClipGainEnvelope(candidate)) {
            continue;
        }
        envelopes[candidate.clipId] = {
            clipId: candidate.clipId,
            enabled: candidate.enabled,
            points: candidate.points.map((point) => ({
                id: point.id,
                beatOffset: point.beatOffset,
                gainDb: point.gainDb,
            })),
        };
    }
    return envelopes;
}

function isExactClipGainEnvelope(clipId: string, value: unknown): value is ClipGainEnvelope {
    if (!isClipGainEnvelope(value) || value.clipId !== clipId) {
        return false;
    }
    if (Object.keys(value).length !== CLIP_GAIN_ENVELOPE_KEYS.length) {
        return false;
    }
    return value.points.every((point) => Object.keys(point).length === GAIN_ENVELOPE_POINT_KEYS.length);
}

function isExactGainEnvelopeStoreState(value: unknown): value is GainEnvelopeStoreState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'envelopes') {
        return false;
    }
    if (!('envelopes' in value) || value.envelopes === null || typeof value.envelopes !== 'object') {
        return false;
    }
    if (Array.isArray(value.envelopes)) {
        return false;
    }
    return Object.entries(value.envelopes).every(([clipId, envelope]) => isExactClipGainEnvelope(clipId, envelope));
}

/**
 * Store-shaped decoder for the `gainEnvelopes` document slot.
 *
 * The file path decodes an array through {@link sanitizeClipGainEnvelopes};
 * the document holds the same envelopes already keyed by clip id, so this
 * decodes the keyed form and re-keys each envelope by its own `clipId` — an
 * entry filed under the wrong key would silently apply another clip's fades.
 *
 * Returns the argument itself when it already decodes exactly, so `createStore`
 * does not write a sanitized copy back over a shared document.
 */
function sanitizeGainEnvelopeStoreState(value: unknown): GainEnvelopeStoreState {
    if (isExactGainEnvelopeStoreState(value)) {
        return value;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !('envelopes' in value)) {
        return { envelopes: {} };
    }
    const source = value.envelopes;
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        return { envelopes: {} };
    }
    return { envelopes: sanitizeClipGainEnvelopes(Object.values(source)) };
}

export const gainEnvelopeStore = createStore<GainEnvelopeStoreState>({
    storage: createAutomergeStorage<GainEnvelopeStoreState>(DOC_PREFIX_ROOT, 'gainEnvelopes', {
        // A document without the `gainEnvelopes` slot resets the store to empty
        // rather than back-writing this replica's cache (audit CC-2). Envelopes
        // are keyed by clip id, which is not unique across projects, so a stale
        // entry would attach to an unrelated clip in the incoming project.
        hydrateMissing: () => ({ envelopes: {} }),
    }),
    initialData: defaultGainEnvelopeStoreState,
    sanitize: sanitizeGainEnvelopeStoreState,
});

/** Drop the gain envelope keyed by a clip id (e.g. on clip removal). */
export function removeEnvelope(clipId: string): void {
    const current = gainEnvelopeStore.value ?? defaultGainEnvelopeStoreState;
    if (!(clipId in current.envelopes)) {
        return;
    }
    const { [clipId]: _removed, ...rest } = current.envelopes;
    gainEnvelopeStore.set({ envelopes: rest });
}

/**
 * Test-only: reset the store to its empty default.
 *
 * Guarded behind `import.meta.env.MODE` so it cannot mutate the live store in a
 * production build — under Vitest `MODE` is `'test'`. Exported (rather than
 * moved to a test helper) so the existing `*.spec.ts` callers keep working.
 */
export function __resetGainEnvelopesForTest(): void {
    if (import.meta.env.MODE !== 'test') {
        return;
    }
    gainEnvelopeStore.set(defaultGainEnvelopeStoreState);
}
