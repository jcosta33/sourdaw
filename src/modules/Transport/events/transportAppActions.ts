import { type TempoMapEdit, type TempoMapRowPlan } from '#/utils/tempoMapRowPlan';

import { type TempoAudioSourcePromotionSnapshot } from './tempoAudioSourceSnapshots';

export type TransportAppAction =
    | {
          type: 'setTempo';
          payload: {
              bpm: number;
              /**
               * Internal undo/redo routing. A bare `setTempo` resolves its target from
               * the live playhead, which makes it position-dependent — replaying it as
               * an inverse would re-resolve against wherever the playhead has moved to
               * and rewrite a different tempo event. The inverse and redo actions
               * therefore name the tempo-map change the original write landed on.
               * AiRuntime payload validation rejects this field.
               */
              tempoChangeId?: string | null;
              /** Application-owned replay guard. AiRuntime payload validation rejects this field. */
              expectedBpm?: number;
              /** Owning admission capture. External arguments are discarded and derived afresh. */
              audioSourcePromotion?: TempoAudioSourcePromotionSnapshot;
          };
      }
    | {
          type: 'restoreTempoEdit';
          payload: {
              bpm: number;
              expectedBpm: number;
              tempoChangeId: string | null;
              sourceDirection: 'promote' | 'restore';
              audioSourcePromotion: TempoAudioSourcePromotionSnapshot;
          };
      }
    | {
          type: 'editTempoMap';
          payload: {
              edit: TempoMapEdit;
              /** Owner-derived at admission; caller captures never grant writes. */
              rowPlan?: TempoMapRowPlan;
              audioSourcePromotion?: TempoAudioSourcePromotionSnapshot;
          };
      }
    | {
          type: 'restoreTempoMapEdit';
          payload: {
              rowPlan: TempoMapRowPlan;
              rowDirection: 'apply' | 'restore';
              sourceDirection: 'promote' | 'restore';
              audioSourcePromotion: TempoAudioSourcePromotionSnapshot;
          };
      }
    | {
          type: 'setTimeSignature';
          payload: {
              numerator: number;
              denominator: number;
              expectedNumerator?: number;
              expectedDenominator?: number;
          };
      }
    | { type: 'setPlayback'; payload: { playing: boolean } }
    | { type: 'togglePlayback'; payload?: undefined }
    | { type: 'stopPlayback'; payload?: undefined }
    | { type: 'toggleRecording'; payload?: undefined }
    | {
          type: 'setMasterGain';
          /**
           * Exactly one level form: the stored linear fraction `gain`, an absolute
           * `gainDb`, or a `deltaDb` relative to the live master level. The handler
           * converts the decibel forms against the live value; the transport store
           * keeps its linear percent either way.
           *
           * `expectedPercent` is the master percent the caller measured before it
           * derived `gain`. When present the handler conflicts instead of writing
           * if the live percent has moved, so a fader change that lands between a
           * caller's snapshot and command admission is never silently clobbered.
           * Omit it for a direct, absolute set that should always win.
           */
          payload: {
              /** Stored linear fraction. Exactly one of `gain`, `gainDb`, `deltaDb`. */
              gain?: number;
              /** Absolute master level in decibels. */
              gainDb?: number;
              /** Change relative to the live master level, in decibels. */
              deltaDb?: number;
              expectedPercent?: number;
          };
      }
    | {
          type: 'restoreMasterGain';
          payload: { expectedPercent: number; replacementPercent: number };
      }
    | { type: 'toggleLoop'; payload?: undefined }
    | { type: 'toggleMetronome'; payload?: undefined }
    | { type: 'setMetronomeVolume'; payload: { volume?: number; volumeDb?: number; deltaDb?: number } }
    | { type: 'setLoopRegion'; payload: { startBeat: number; endBeat: number } }
    | { type: 'setLoopEnabled'; payload: { enabled: boolean } }
    | { type: 'setMetronomeEnabled'; payload: { enabled: boolean } }
    | {
          type: 'restoreLoopRegion';
          payload: {
              expected: { loopStart: number; loopEnd: number; isLooping: boolean };
              replacement: { loopStart: number; loopEnd: number; isLooping: boolean };
          };
      }
    | { type: 'navigateSection'; payload: { direction: 'previous' | 'next' } }
    | { type: 'rehearseSection'; payload: { sectionId: string; loop: boolean } }
    | { type: 'seekPlayhead'; payload: { beat: number } }
    | { type: 'setPunchIn'; payload: { beat: number } }
    | { type: 'setPunchOut'; payload: { beat: number } }
    | {
          type: 'setPunchEnabled';
          payload: {
              enabled: boolean;
              /** Internal compare-and-swap guard. AiRuntime payload validation rejects this field. */
              expectedEnabled?: boolean;
          };
      }
    | {
          /** Internal compare-and-swap replay action for both punch endpoints. */
          type: 'restorePunchRegion';
          payload: {
              expected: { punchInBeat: number; punchOutBeat: number };
              replacement: { punchInBeat: number; punchOutBeat: number };
          };
      }
    | { type: 'togglePunch'; payload?: undefined }
    | {
          type: 'toggleCountIn';
          /** `enabled` sets that state; omitted, the action flips the current one. `expectedEnabled` is the internal compare-and-swap guard that AiRuntime payload validation rejects. */
          payload?: { enabled?: boolean; expectedEnabled?: boolean };
      }
    | {
          type: 'setCountInBars';
          /** `expectedBars` is the internal compare-and-swap guard that AiRuntime payload validation rejects. */
          payload: { bars: number; expectedBars?: number };
      }
    | {
          type: 'togglePreRoll';
          /** `enabled` sets that state; omitted, the action flips the current one. `expectedEnabled` is the internal compare-and-swap guard that AiRuntime payload validation rejects. */
          payload?: { enabled?: boolean; expectedEnabled?: boolean };
      }
    | {
          type: 'setPreRollBars';
          /** `expectedBars` is the internal compare-and-swap guard that AiRuntime payload validation rejects. */
          payload: { bars: number; expectedBars?: number };
      }
    | { type: 'addTimeSignatureChange'; payload: { beat: number; numerator: number; denominator: number } }
    | { type: 'removeTimeSignatureChange'; payload: { beat: number } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        transport: TransportAppAction;
    }
}
