import { canonicalJson } from '#/utils/canonicalDigest';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { type Clip, type DeviceStateChunk } from '../models/Track';

/**
 * Every clip field the freeze render reads — what `scheduleTrackClips`
 * consumes directly or through `projectOfflineAudioClipPlaybacks` and the
 * MIDI note projection to decide what a clip sounds like. An edit to any of
 * them must change the freeze source signature, or a frozen track keeps
 * playing its stale buffer (audit #4591: mute, fades, slip and reverse all
 * left the old id/start/duration/hash/gain signature untouched).
 */
type RenderAffectingClipFields = Pick<
    Clip,
    | 'id'
    | 'startBeat'
    | 'endBeat'
    | 'type'
    | 'audioBufferId'
    | 'assetHash'
    | 'audioOffsetBeats'
    | 'audioOffsetSeconds'
    | 'midiOffsetBeats'
    | 'fadeInBeats'
    | 'fadeOutBeats'
    | 'gain'
    | 'muted'
    | 'stretchMode'
    | 'stretchRatio'
    | 'loopEnabled'
    | 'loopLength'
>;

type TrackFreezeSource = {
    clips: readonly RenderAffectingClipFields[];
    devices: readonly {
        id: string;
        type: string;
        parameterValues: Readonly<Record<string, number>>;
        bypassed: boolean;
        /** The device's own persisted state chunk; render state the offline
         *  render hydrates the device from. */
        deviceState?: DeviceStateChunk;
    }[];
};

function clipSignatureEntry(clip: RenderAffectingClipFields): string {
    const duration = clip.endBeat - clip.startBeat;
    // Optional slots collapse to the value the renderer reads anyway
    // (`?? 0`, `?? false`), so a handler writing the default over an absent
    // field does not mark a render-identical track stale. Identity strings
    // (`audioBufferId`, `stretchMode`, `stretchRatio`) stay raw: absent
    // means absent.
    const signature = [
        clip.id,
        clip.startBeat,
        duration,
        clip.assetHash ?? '',
        clip.gain,
        clip.type,
        clip.audioBufferId ?? '',
        clip.audioOffsetBeats ?? 0,
        clip.midiOffsetBeats ?? 0,
        clip.fadeInBeats,
        clip.fadeOutBeats,
        clip.muted,
        clip.stretchMode ?? '',
        clip.stretchRatio ?? '',
        clip.loopEnabled ?? false,
        clip.loopLength ?? 0,
    ].join(':');

    // Preserve legacy signatures byte-for-byte. When the authoritative source
    // entrance is present, sign its presence and value, including explicit 0.
    return clip.audioOffsetSeconds === undefined
        ? signature
        : `${signature}:audioOffsetSeconds=${clip.audioOffsetSeconds}`;
}

/*
 * GRAND-BOULE CHUNK CANONICALIZATION — LOCAL PROJECTION.
 *
 * Source of truth: `src/modules/GrandBoule/models/GrandBouleDeviceState.ts` —
 * `fromGrandBouleDeviceState` (decode, absent-leaf defaults, wholesale-default
 * rejection) followed by `toGrandBouleDeviceState` (canonical leaf set). The
 * signature folds exactly that round-trip so a chunk carrying absent optional
 * leaves and the defaulted-present chunk a commit or undo writes back hash the
 * same — the offline render hydrates both identically, so they must not mark a
 * frozen track stale.
 *
 * This file cannot import the decoder: a cross-module import must target a
 * contract-folder barrel, `models/` is not one, and the `GrandBoule/useCases`
 * barrel transitively imports Arrangement stores (`commitGrandBouleDeviceState`
 * reads `trackStore`), so the edge would close an Arrangement→GrandBoule→
 * Arrangement cycle. The mirror below is therefore a standing drift risk: if
 * the decoder's leaf set, ranges, or defaults change, change them here in the
 * same commit or absent and defaulted leaves fold differently again.
 */
const GRAND_BOULE_CHUNK_VERSION = 1;
const GRAND_BOULE_MODEL_IDS = new Set(['balanced-grand', 'mellow-grand', 'clear-grand', 'singing-grand']);

function finiteInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** The five morph leaves as the decoder validates them, or `null` when any is invalid. */
function decodeGrandBouleMorphFields(data: Record<string, unknown>): string | null {
    const { modelA, modelB, morphPosition, layerBalance, enabled } = data;
    if (
        typeof modelA !== 'string' ||
        !GRAND_BOULE_MODEL_IDS.has(modelA) ||
        typeof modelB !== 'string' ||
        !GRAND_BOULE_MODEL_IDS.has(modelB) ||
        !finiteInRange(morphPosition, 0, 1) ||
        !finiteInRange(layerBalance, -1, 1) ||
        typeof enabled !== 'boolean'
    ) {
        return null;
    }
    return [modelA, modelB, morphPosition, layerBalance, enabled].join(':');
}

/**
 * The temperament leaf, absent folded to the decoder's default. An absent leaf
 * defaults while a `null` one rejects — the decoder's `??`-less check — so the
 * fold must not swallow an invalid present value.
 */
function decodeGrandBouleTemperamentLeaf(data: Record<string, unknown>): number | null {
    const { temperament } = data;
    if (temperament === undefined) {
        return 0;
    }
    if (!(typeof temperament === 'number' && Number.isInteger(temperament) && temperament >= 0 && temperament <= 5)) {
        return null;
    }
    return temperament;
}

/**
 * The four preset-voicing leaves, defaulting to the neutral voicing when
 * absent and rejecting values outside each parameter's declared range.
 */
function decodeGrandBoulePresetParameters(data: Record<string, unknown>): string | null {
    const savedHammerHardness = data.hammerHardness ?? 0;
    const savedVelocityCurve = data.velocityCurve ?? 1;
    const savedStereoWidth = data.stereoWidth ?? 0.6;
    const savedToneTilt = data.toneTilt ?? 0;
    if (
        !finiteInRange(savedHammerHardness, -1, 1) ||
        !finiteInRange(savedVelocityCurve, 0.5, 2) ||
        !finiteInRange(savedStereoWidth, 0, 1) ||
        !finiteInRange(savedToneTilt, -1, 1)
    ) {
        return null;
    }
    return [savedHammerHardness, savedVelocityCurve, savedStereoWidth, savedToneTilt].join(':');
}

/**
 * The canonical projection of a chunk that decodes, or `null` when the decoder
 * would reject it wholesale. Mirrors `fromGrandBouleDeviceState` exactly: an
 * absent `temperament` leaf defaults while a `null` one rejects, and the four
 * voicing leaves fold both through `??` before their range check.
 */
function decodeGrandBouleLeaves(data: Record<string, unknown>): string | null {
    const morph = decodeGrandBouleMorphFields(data);
    const temperament = decodeGrandBouleTemperamentLeaf(data);
    const parameters = decodeGrandBoulePresetParameters(data);
    if (morph === null || temperament === null || parameters === null) {
        return null;
    }
    // Fixed-order join of the ten decoded leaves, absent optionals folded to
    // the decoder's defaults. A function of the decoded state alone, so two
    // chunks the renderer hydrates identically can never hash differently.
    return `${morph}:${temperament}:${parameters}`;
}

/** The wholesale-default projection the decoder falls back to on any rejection. */
const GRAND_BOULE_DEFAULT_PROJECTION = ['balanced-grand', 'clear-grand', 0, 0, false, 0, 0, 1, 0.6, 0].join(':');

/** The decoded projection for a chunk inside the family, `null` when it fails the envelope or the schema. */
function decodedGrandBouleProjection(deviceState: DeviceStateChunk): string | null {
    if (
        deviceState.version !== GRAND_BOULE_CHUNK_VERSION ||
        typeof deviceState.data !== 'object' ||
        deviceState.data === null
    ) {
        return null;
    }
    return decodeGrandBouleLeaves(deviceState.data);
}

/**
 * A built-in device's state chunk is render state too: the offline render
 * hydrates the device from it (`prepareOfflineGrandBoule` restores
 * temperament and preset voicing from the chunk), so a chunk edit must mark
 * a frozen track stale exactly like a parameter edit. Absent stays absent —
 * a device that never wrote a chunk produces the signature it always did, so
 * pre-chunk tracks do not churn stale on this change.
 *
 * The Grand Boule family is discriminated by the device entry's type — the
 * same `DEVICE_TYPE_IDS.grandBoule` comparison the offline hydration
 * (`prepareOfflineDeviceSetup`) dispatches on — because `DeviceStateChunk` is
 * a generic `{version, data}` envelope other native devices write with their
 * own schemas. Inside the family every chunk is decoded to the canonical
 * projection above (an undecodable chunk hydrates as wholesale defaults, so
 * it signs as them); every other device's chunk hashes raw through
 * `canonicalJson` so key order never leaks into the signature, and the
 * leading delimiter rides the slot so a present chunk can never collide with
 * an absent one.
 */
function deviceStateSignature(deviceType: string, deviceState: DeviceStateChunk | undefined): string {
    if (deviceState === undefined) {
        return '';
    }
    if (deviceType === DEVICE_TYPE_IDS.grandBoule) {
        const leaves = decodedGrandBouleProjection(deviceState);
        return `:${leaves ?? GRAND_BOULE_DEFAULT_PROJECTION}`;
    }
    return `:${canonicalJson(deviceState)}`;
}

/**
 * Content signature of everything a track's frozen buffer was rendered from:
 * its clips' render-affecting fields and its devices.
 *
 * The clip field list above is restated from the renderers' reads, not
 * derived from them, and that restatement is this file's standing drift
 * risk: the offline render's one extraction
 * (`projectOfflineAudioClipPlaybacks`) folds region bounds, the tempo map
 * and buffer duration into destination-timeline seconds, so it cannot seed
 * a context-free content hash, and it covers audio clips only. A
 * render-affecting clip field added to a scheduler without extending the
 * list here re-opens audit #4591 — the frozen track silently replays its
 * stale buffer again; one context-free projection feeding both renderers
 * and this signature is the route that would close that for good.
 *
 * Deliberately outside: MIDI note content, clip gain envelopes
 * (`gainEnvelopeStore`) and warp markers (`warpStates`) live in stores
 * keyed by clip id that staleness detection does not watch and this
 * signature never receives; note edits on frozen tracks are refused at the
 * handler instead.
 */
export function createTrackFreezeSourceSignature(source: TrackFreezeSource): string {
    const clipSignatures = [...source.clips]
        .sort((alpha, buffer) => alpha.startBeat - buffer.startBeat || alpha.id.localeCompare(buffer.id))
        .map(clipSignatureEntry);
    const deviceSignatures = source.devices.map((device) => {
        const parameters = Object.entries(device.parameterValues)
            .sort(([alpha], [buffer]) => alpha.localeCompare(buffer))
            .map(([name, value]) => `${name}=${value}`)
            .join(',');
        return `${device.id}:${device.type}:${parameters}:${device.bypassed}${deviceStateSignature(device.type, device.deviceState)}`;
    });

    return `${clipSignatures.join('|')}||${deviceSignatures.join('|')}`;
}
