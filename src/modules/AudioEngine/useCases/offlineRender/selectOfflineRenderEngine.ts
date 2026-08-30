/**
 * The one place the offline render chooses its engine.
 *
 * As of the D3.c.2 cutover (#2225) the selection is live: a desktop export
 * whose addon answers the graph commands, and whose project the native
 * timeline can hold, renders through `native/offline`
 * (`renderOfflineWithNativeEngine`); everything else renders through
 * `web-audio/offline` (`createOfflineRenderBackend`). Degradation is
 * observable by construction — every web selection carries the reason, and
 * `renderOffline` surfaces the degraded ones on `onWarning`, the export's
 * established warning channel.
 *
 * ── The content gates ──────────────────────────────────────────────────────
 *
 * Each gate names a behaviour only the Web Audio renderer has today, so a
 * project that needs it degrades with a reason instead of exporting into a
 * native refusal:
 *
 *   - **Frozen tracks** replay a pre-rendered buffer through the web strip.
 *   - **Device chains** — no built-in device has a native offline realisation
 *     yet, and that conservatively covers instruments, sidechain targets and
 *     Toaster routing, which are all devices.
 *   - **MIDI programme** — instruments render web-side; a native render of a
 *     MIDI clip would be a rest that reads as a correct file.
 *   - **Stretched clips** — the native timeline refuses any non-unity rate
 *     (`stretched-clip-unsupported`, #2219).
 *   - **Bus-source sends** are not a gate: live and offline native producers
 *     drop a send whose source strip is a bus (the same drop as a send naming
 *     no built bus), so native export runs minus that send's contribution.
 *     Growing a bus send tap is engine work, not a reason to refuse native.
 *   - **Bus → track routing** — a bus routed at an ordinary (non-master)
 *     track is still gated here. A bus whose resolved target is the master
 *     track is a mapper-accepted edge into the master strip, so the default
 *     bus output is not this gate.
 *
 * Mute, pan and solo on a bus are not a gate: the native strip holds them
 * (`SetBusMute` / `SetBusSoloGate` / `BusPan`, #3103), and the offline
 * projection already puts that shape on `create-bus-strip`. Mixdown still
 * omits a solo-gated track from `scheduledTracks` rather than solo-gating
 * the strip, matching the web path.
 *
 * The gates admit conservatively: anything they cannot prove native-renderable
 * goes web, because a wrong `web-audio/offline` answer costs speed while a
 * wrong `native/offline` answer costs a failed or unfaithful export.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';

import { resolveOutputTarget } from './resolveOutputTarget';

export type OfflineRenderEngineSelection =
    | Readonly<{ engine: 'native/offline'; transport: NativeGraphTransport }>
    | Readonly<{
          engine: 'web-audio/offline';
          reason: string;
          /**
           * True when a native engine exists here and was passed over — the
           * caller surfaces those on `onWarning`. False in a browser, where
           * the web renderer is the platform, not a degradation.
           */
          degraded: boolean;
      }>;

export type SelectOfflineRenderEngineInput = Readonly<{
    /** Every track this render will build a strip for. */
    renderableTracks: readonly Track[];
    /** The tracks whose programme reaches the mix. */
    scheduledTracks: readonly Track[];
}>;

/** The first gate that holds, or `null` when the native engine can take it. */
function contentGateReason(input: SelectOfflineRenderEngineInput): string | null {
    const { renderableTracks, scheduledTracks } = input;
    for (const track of renderableTracks) {
        if (track.freezeState.status === 'frozen') {
            return `track "${track.name}" is frozen and replays a pre-rendered buffer`;
        }
        if (track.devices.length > 0) {
            return `track "${track.name}" carries a device chain`;
        }
    }
    for (const track of scheduledTracks) {
        for (const clip of track.clips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type === 'midi') {
                return `track "${track.name}" plays MIDI programme`;
            }
            const stretched = clip.stretchMode && clip.stretchMode !== 'off' && (clip.stretchRatio ?? 1) !== 1;
            if (stretched) {
                return `clip "${clip.name || clip.id}" on track "${track.name}" is time-stretched (#2219)`;
            }
        }
    }
    const busIds = new Set(renderableTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackIds = new Set(renderableTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));
    for (const track of renderableTracks) {
        if (track.kind !== 'bus') {
            continue;
        }
        const target = resolveOutputTarget({
            outputId: track.outputId,
            busStripIds: busIds,
            trackStripIds: trackIds,
        });
        if (target.kind === 'track' && target.trackId !== 'master') {
            return `bus "${track.name}" routes into a track, which the native engine refuses`;
        }
    }
    return null;
}

/**
 * The composition decision between the two renderers. Async because the
 * desktop half is a live question — the addon behind the bridge answers an
 * empty mapping probe, or it does not.
 */
export async function selectOfflineRenderEngine(
    input: SelectOfflineRenderEngineInput
): Promise<OfflineRenderEngineSelection> {
    const availability = await probeNativeGraphTransport();
    if (!availability.available) {
        return {
            engine: 'web-audio/offline',
            reason: availability.reason,
            degraded: availability.runtime === 'desktop',
        };
    }
    const gate = contentGateReason(input);
    if (gate !== null) {
        return { engine: 'web-audio/offline', reason: gate, degraded: true };
    }
    return { engine: 'native/offline', transport: availability.transport };
}
