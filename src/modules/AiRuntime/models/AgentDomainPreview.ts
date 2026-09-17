import { type AppAction } from '#/utils/handlerContract';

/**
 * Non-authoritative domain previews for a proposed command batch.
 *
 * A preview handle is data read out of the isolated command preview's projected
 * document and the audio buffer cache. Nothing here writes project truth, the
 * CRDT, or any store, and a handle is never an execution receipt: it describes
 * what the batch would produce so a person can judge it before committing.
 *
 * A domain that cannot produce a handle reports `unsupported` with the reason
 * it failed, never an empty handle, because an absent preview and an empty
 * preview mean opposite things to the caller deciding whether to auto-commit.
 */

export const AGENT_PREVIEW_DOMAINS = ['midi-overlay', 'audio-audition', 'automation-curve', 'device-graph'] as const;

export const AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION = 1 as const;

export type AgentPreviewDomain = (typeof AGENT_PREVIEW_DOMAINS)[number];

/**
 * - `external-execution`: an action in the domain cannot run inside the isolated
 *   projection, so its post-state never exists to read.
 * - `isolated-render-unavailable`: the domain's audio cannot be auditioned
 *   without rendering, which a preview must not do.
 * - `projection-slot-missing`: the document slot the handle reads is absent or
 *   malformed.
 * - `graph-invalid`: the projected routing and device topology does not compile.
 */
export type AgentDomainPreviewUnsupportedReason =
    'external-execution' | 'isolated-render-unavailable' | 'projection-slot-missing' | 'graph-invalid';

export type AgentDomainPreviewInput = {
    readonly actions: readonly AppAction[];
    readonly projectDocument: Readonly<Record<string, unknown>>;
};

/** Projected notes of one affected clip, in the stored note shape. */
export type AgentMidiOverlayClip = {
    readonly clipId: string;
    readonly notes: readonly {
        readonly id: string;
        readonly pitch: number;
        readonly startBeat: number;
        readonly duration: number;
        readonly velocity: number;
    }[];
};

/** Figures of one cached buffer the batch would place, never its samples. */
export type AgentAudioAuditionClip = {
    readonly audioBufferId: string;
    readonly durationSeconds: number;
    readonly sampleRate: number;
    readonly channelCount: number;
};

/** Projected breakpoints of one affected lane, in beat order. */
export type AgentAutomationCurveLane = {
    readonly laneId: string;
    readonly points: readonly { readonly beat: number; readonly value: number }[];
};

/** The compiled projected routing and device topology. */
export type AgentDeviceGraphTopology = {
    readonly edgeCount: number;
    readonly nodeIds: readonly string[];
};

type AgentDomainPreviewUnsupported = {
    readonly status: 'unsupported';
    readonly domain: AgentPreviewDomain;
    readonly reason: AgentDomainPreviewUnsupportedReason;
};

export type AgentDomainPreviewResult =
    | {
          readonly status: 'previewed';
          readonly domain: 'midi-overlay';
          readonly schemaVersion: typeof AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION;
          readonly handle: readonly AgentMidiOverlayClip[];
      }
    | {
          readonly status: 'previewed';
          readonly domain: 'audio-audition';
          readonly schemaVersion: typeof AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION;
          readonly handle: readonly AgentAudioAuditionClip[];
      }
    | {
          readonly status: 'previewed';
          readonly domain: 'automation-curve';
          readonly schemaVersion: typeof AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION;
          readonly handle: readonly AgentAutomationCurveLane[];
      }
    | {
          readonly status: 'previewed';
          readonly domain: 'device-graph';
          readonly schemaVersion: typeof AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION;
          readonly handle: AgentDeviceGraphTopology;
      }
    | AgentDomainPreviewUnsupported;

export type AgentDomainPreviewSupport =
    | { readonly domain: AgentPreviewDomain; readonly status: 'supported' }
    | {
          readonly domain: AgentPreviewDomain;
          readonly status: 'unsupported';
          readonly reason: AgentDomainPreviewUnsupportedReason;
      };
