import { canonicalJson } from '#/utils/canonicalDigest';

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
    return [
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
}

/**
 * A built-in device's state chunk is render state too: the offline render
 * hydrates the device from it (`prepareOfflineGrandBoule` restores
 * temperament and preset voicing from the chunk), so a chunk edit must mark
 * a frozen track stale exactly like a parameter edit. Absent stays absent —
 * a device that never wrote a chunk produces the signature it always did, so
 * pre-chunk tracks do not churn stale on this change. Serialized through
 * `canonicalJson` so the chunk's key order never leaks into the signature;
 * the leading delimiter rides the slot so a present chunk can never collide
 * with an absent one.
 */
function deviceStateSignature(deviceState: DeviceStateChunk | undefined): string {
    if (deviceState === undefined) {
        return '';
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
        return `${device.id}:${device.type}:${parameters}:${device.bypassed}${deviceStateSignature(device.deviceState)}`;
    });

    return `${clipSignatures.join('|')}||${deviceSignatures.join('|')}`;
}
