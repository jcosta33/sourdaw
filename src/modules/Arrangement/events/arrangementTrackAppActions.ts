import { type AutomationMode } from '#/modules/Automation/events';
import { type AutomationRecordingPolicy } from '#/utils/handlerContract';

import {
    type ClipSnapshot,
    type GeneratedMidiStateGuard,
    type StemImportTrackSnapshot,
} from './arrangementClipSnapshots';
import {
    type FreezeStateSnapshot,
    type RestoreTrackPayloadSnapshot,
    type TrackKind,
} from './arrangementTrackSnapshots';

export type TrackGroupMembershipSnapshot = { readonly trackId: string; readonly groupId: string | null };
export type TrackHeightSnapshot = { readonly trackId: string; readonly height: number };
export type TrackAlternativeStateSnapshot = {
    readonly alternatives: readonly { readonly id: string }[];
    readonly activeAlternativeId: string | null;
    readonly clips: readonly ClipSnapshot[];
};

type LegacyVcaGroupSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly gain: number;
    readonly muted: boolean;
    readonly trackIds: readonly string[];
};

type LegacyVcaGroupRowState = {
    readonly group: LegacyVcaGroupSnapshot;
    readonly index: number;
} | null;

type LegacyVcaGroupRowPatch = {
    readonly groupId: string;
    readonly expected: LegacyVcaGroupRowState;
    readonly replacement: LegacyVcaGroupRowState;
};

type LegacyVcaGroupGainPatch = {
    readonly groupId: string;
    readonly expectedGain: number;
    readonly replacementGain: number;
};

type LegacyVcaGroupMembershipPatch = {
    readonly groupId: string;
    readonly trackId: string;
    readonly expectedIndices: readonly number[];
    readonly replacementIndices: readonly number[];
};

type LegacyVcaTrackMembershipPatch = {
    readonly trackId: string;
    readonly expectedVcaGroupId: string | null;
    readonly replacementVcaGroupId: string | null;
};

export type ArrangementTrackAppAction =
    | {
          type: 'importStemSet';
          payload: {
              selectionId: string;
              groupName: string;
              projectTempo: number;
              folderId: string;
              folderColor?: string;
              folderAlternativeId?: string;
              stems: StemImportTrackSnapshot[];
          };
      }
    | {
          /** Guarded inverse of one atomic stem-set import. */
          type: 'discardImportedStemSet';
          payload: {
              folderId: string;
              stemTrackIds: string[];
              guards: Array<{ trackId: string; generatedMidiStateGuard: GeneratedMidiStateGuard }>;
          };
      }
    | {
          type: 'addTrack';
          payload: {
              id?: string;
              /** Omitted for the owner's next default name for the kind ("MIDI 3"), resolved once before the action is recorded. */
              name?: string;
              kind: TrackKind;
              select?: boolean;
              /** Internal replay metadata; provider payloads cannot set this field. */
              color?: string;
              /** Internal replay metadata; provider payloads cannot set this field. */
              initialAlternativeId?: string;
              /** Internal replay metadata; provider payloads cannot set this field. */
              initialDeviceId?: string;
              /** Internal arrangement composition metadata; provider payloads cannot set this field. */
              parentId?: string;
              /** Internal arrangement composition metadata; provider payloads cannot set this field. */
              outputId?: string;
              /** Internal arrangement composition metadata; provider payloads cannot set this field. */
              withoutDefaultDevice?: boolean;
          };
      }
    | {
          type: 'removeTrack';
          payload: {
              trackId: string;
              expectedKind?: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
              expectedMuted?: boolean;
              expectedClipIds?: readonly string[];
              expectedAlternativeClipIds?: readonly string[];
              expectedVcaGroupId?: string | null;
              expectedVcaMembershipGroupIds?: readonly string[];
          };
      }
    | {
          type: 'discardCreatedTrack';
          payload: { trackId: string; generatedMidiStateGuard?: GeneratedMidiStateGuard };
      }
    | { type: 'removeAllTracks'; payload?: undefined }
    | { type: 'renameTrack'; payload: { trackId: string; name: string; expectedName?: string } }
    | {
          type: 'createTrackAlternative';
          payload: { trackId: string; name: string; duplicateActive: boolean; alternativeId?: string };
      }
    | { type: 'switchTrackAlternative'; payload: { trackId: string; alternativeId: string } }
    | { type: 'renameTrackAlternative'; payload: { trackId: string; alternativeId: string; name: string } }
    | {
          type: 'deleteTrackAlternative';
          payload: { trackId: string; alternativeId: string; fallbackAlternativeId?: string };
      }
    | { type: 'selectTrack'; payload: { trackId: string } }
    | { type: 'muteTrack'; payload: { trackId: string; muted: boolean; expectedMuted: boolean } }
    | { type: 'soloTrack'; payload: { trackId: string; soloed: boolean; expectedSoloed?: boolean } }
    | { type: 'toggleSoloSafe'; payload: { trackId: string } }
    | { type: 'setSoloSafe'; payload: { trackId: string; soloSafe: boolean } }
    | {
          type: 'restoreSoloSafe';
          payload: { trackId: string; expected: boolean; replacement: boolean };
      }
    | {
          type: 'armTrack';
          payload: {
              trackId: string;
              armed: boolean;
              /** Internal runtime-routing metadata. AiRuntime payload validation rejects these fields. */
              midiInputTrackId?: string | null;
              expectedMidiInputTrackId?: string | null;
              midiInputOwnerId?: string | null;
              expectedMidiInputOwnerId?: string | null;
          };
      }
    | {
          type: 'freezeTrack';
          payload: {
              trackId: string;
              /**
               * Application-owned id for the freeze this action mints, resolved before
               * dispatch so `describe()` can name the exact post-state its inverse guards
               * against. The rest of the resulting freeze metadata — content hash,
               * compensation, render settings — is only knowable after the offline render,
               * so the guard is this id: while the track still carries it, nothing has
               * re-frozen it since. AiRuntime payload validation rejects this field.
               */
              freezeId?: string;
          };
      }
    | { type: 'unfreezeTrack'; payload: { trackId: string } }
    | {
          /** Guarded inverse and redo of `freezeTrack` and `unfreezeTrack`, in both
           *  directions. Re-freezing is not an inverse of unfreeze: it re-renders the
           *  current source and mints a new take rather than restoring the prior one. And
           *  `unfreezeTrack` is not a complete inverse of freeze: `freezeTrack` also
           *  accepts `stale` and `error` states that may already reference a buffer, which
           *  a bare unfreeze would clear. This carries the whole freeze aggregate on both
           *  sides so either direction restores exactly what was there, and conflicts when
           *  the live track no longer matches `expected`. Emitted only by those two
           *  handlers' `describe()`. */
          type: 'restoreFreezeState';
          payload: {
              trackId: string;
              expected: FreezeStateSnapshot;
              replacement: FreezeStateSnapshot;
          };
      }
    | { type: 'flattenTrack'; payload: { trackId: string } }
    | { type: 'bounceInPlace'; payload: { trackId: string } }
    | { type: 'reorderTrack'; payload: { trackId: string; newIndex: number } }
    | { type: 'duplicateTrack'; payload: { trackId: string; targetTrackId?: string; select?: boolean } }
    | {
          type: 'createBus';
          payload: {
              name: string;
              /** Internal replay identity. */ busId?: string;
              /** Internal replay metadata captured from the first committed bus. */ color?: string;
              /** Internal replay metadata captured from the first committed bus. */ initialAlternativeId?: string;
              /** Application-owned initial fader value; provider payloads cannot set this field. */ initialGain?: number;
              /** Application-owned replay guard for names that must remain unclaimed. */
              expectedAbsentTrackNames?: readonly string[];
              /** Application-owned replay guard for protected routes outside the mutation set. */
              expectedTrackOutputs?: readonly { trackId: string; outputId: string }[];
          };
      }
    | {
          type: 'createFolder';
          /** `folderTrackId` is application-owned: it is materialized before `describe` so the
           *  inverse can name the exact track this command appends. Providers cannot set it. */
          payload: { name: string; folderTrackId?: string };
      }
    | { type: 'setTrackInput'; payload: { trackId: string; inputId: string | null } }
    | {
          /** Guarded inverse and redo of `setTrackInput`. Replaying the captured prior
           *  input unconditionally overwrites any routing change made between the forward
           *  action and the undo — locally or through collaboration. This carries the
           *  input the forward action left behind (`expected`) and the one to put back
           *  (`replacement`), and conflicts when the live track no longer matches.
           *  Emitted only by the `setTrackInput` handler's `describe()`. */
          type: 'restoreTrackInput';
          payload: { trackId: string; expected: string | null; replacement: string | null };
      }
    | {
          type: 'setTrackGain';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           *
           * `expectedGain` stays required whichever form asked: every internal caller
           * measures before it writes, and a provider-sourced action is stamped with
           * the live gain during state-guard materialization.
           */
          payload: {
              trackId: string;
              /** Stored linear amplitude. Exactly one of `gain`, `gainDb`, `deltaDb`. */
              gain?: number;
              /** Absolute fader level in decibels. */
              gainDb?: number;
              /** Change relative to the track's live gain, in decibels. */
              deltaDb?: number;
              expectedGain: number;
              automationRecordingPolicy?: AutomationRecordingPolicy;
          };
      }
    | {
          type: 'setTrackPan';
          payload: {
              trackId: string;
              pan: number;
              expectedPan: number;
              automationRecordingPolicy?: AutomationRecordingPolicy;
          };
      }
    | { type: 'setTrackColor'; payload: { trackId: string; color: string; expectedColor?: string } }
    | { type: 'zoomTracksVertical'; payload: { delta: number } }
    | {
          type: 'setTrackOutput';
          payload: { trackId: string; outputId: string; expectedOutputId?: string };
      }
    | {
          type: 'setAutomationMode';
          payload: { trackId: string; mode: AutomationMode; expectedMode?: AutomationMode };
      }
    | { type: 'hideTrack'; payload: { trackId: string; hidden: boolean } }
    | { type: 'disableTrack'; payload: { trackId: string; disabled: boolean } }
    | {
          /** Guarded inverse and redo of `disableTrack`. Negating the requested value is
           *  not an inverse: dispatching `disabled: true` at an already-disabled track
           *  changes nothing, so replaying `disabled: false` on undo would write state the
           *  forward action never wrote. This carries the value the forward action left
           *  behind (`expected`) and the value to put back (`replacement`), and refuses
           *  when the live track no longer matches — so a newer edit is reported as a
           *  conflict instead of being silently overwritten. Emitted only by the
           *  `disableTrack` handler's `describe()`. */
          type: 'restoreTrackDisabled';
          payload: { trackId: string; expected: boolean; replacement: boolean };
      }
    | { type: 'setTrackHeight'; payload: { trackId: string; height: number } }
    | { type: 'foldTrack'; payload: { trackId: string; folded: boolean } }
    | { type: 'groupTracks'; payload: { trackIds: string[]; name: string } }
    | { type: 'ungroupTracks'; payload: { groupId: string } }
    | { type: 'clearSolos'; payload?: undefined }
    | {
          type: 'restoreTrackSoloStates';
          payload: {
              expected: { trackId: string; soloed: boolean }[];
              replacement: { trackId: string; soloed: boolean }[];
          };
      }
    | { type: 'setTrackNotes'; payload: { trackId: string; notes: string } }
    | {
          /** Inverse of `zoomTracksVertical`. Zooming clamps every track's height into a
           *  fixed range, so the opposite delta does not return a track that hit a bound
           *  to the height it had. The prior heights are carried instead. */
          type: 'restoreTrackHeights';
          payload: { expected: readonly TrackHeightSnapshot[]; replacement: readonly TrackHeightSnapshot[] };
      }
    | {
          /** Inverse of `groupTracks` / `ungroupTracks`. Grouping rewrites `groupId` on
           *  every named track, and the tracks were not necessarily ungrouped before, so
           *  the inverse restores the prior membership map instead of ungrouping. */
          type: 'restoreTrackGroupMemberships';
          payload: {
              expected: readonly TrackGroupMembershipSnapshot[];
              replacement: readonly TrackGroupMembershipSnapshot[];
          };
      }
    | {
          /** Inverse of `removeAllTracks`. Carries one `restoreTrack` payload per removed
           *  track so the whole arrangement returns as a single undo unit, in the track
           *  order it had before removal. */
          type: 'restoreTracks';
          payload: { restores: readonly RestoreTrackPayloadSnapshot[] };
      }
    | {
          /** Inverse of track-creating commands (`createFolder`, `loadTrackTemplate`).
           *  The created ids are materialized before `describe`, so the inverse names
           *  exactly the tracks the command appended and no later sibling.
           *  `generatedMidiStateGuards` holds one fingerprint per created track, taken
           *  from the committed track; the discard refuses unless every named track
           *  still matches its own (plugin state captures aside), and removes nothing
           *  on a refusal. Entries recorded before the guards existed carry none and
           *  discard by id alone. */
          type: 'discardCreatedTracks';
          payload: {
              trackIds: readonly string[];
              generatedMidiStateGuards?: readonly {
                  trackId: string;
                  generatedMidiStateGuard: GeneratedMidiStateGuard;
              }[];
          };
      }
    | {
          /** Inverse of `deleteTrackAlternative`. Deletion drops the alternative, may
           *  promote a different one and rewrites the track's live clips, so all three
           *  are restored together under a guard on the current alternative set. */
          type: 'restoreTrackAlternativeState';
          payload: {
              trackId: string;
              expected: TrackAlternativeStateSnapshot;
              replacement: TrackAlternativeStateSnapshot;
          };
      }
    | { type: 'consolidateAllTracks'; payload?: undefined }
    | { type: 'bounceToNewTrack'; payload: { trackId: string } }
    | {
          type: 'createVcaGroup';
          payload: {
              name: string;
              trackIds: string[];
              /** Command-owned replay identity. AiRuntime deliberately does not expose it. */
              vcaGroupId?: string;
          };
      }
    | { type: 'assignToVca'; payload: { trackId: string; vcaGroupId: string } }
    | { type: 'removeFromVca'; payload: { trackId: string } }
    | { type: 'setVcaGain'; payload: { vcaGroupId: string; gain?: number; gainDb?: number; deltaDb?: number } }
    | {
          /** Internal inverse only: conditionally restores the fields touched by one
           *  legacy VCA action. This is not a canonical/user/AI VCA action and is absent
           *  from RuntimeAction. */
          type: 'restoreLegacyVcaState';
          payload: {
              groupRows: readonly LegacyVcaGroupRowPatch[];
              groupGains: readonly LegacyVcaGroupGainPatch[];
              groupMemberships: readonly LegacyVcaGroupMembershipPatch[];
              trackMemberships: readonly LegacyVcaTrackMembershipPatch[];
          };
      }
    | { type: 'setMidiOutput'; payload: { trackId: string; destinationTrackId: string } }
    | { type: 'clearMidiOutput'; payload: { trackId: string } }
    | {
          /** Guarded inverse and redo of `setMidiOutput` and `clearMidiOutput`, in both
           *  directions. Replaying the captured prior destination through a bare set or
           *  clear overwrites any routing change made between the forward action and the
           *  undo. This carries the destination the forward action left behind
           *  (`expected`) and the one to put back (`replacement`) — `null` meaning no
           *  route — and conflicts when the live track no longer matches. Emitted only by
           *  those two handlers' `describe()`. */
          type: 'restoreMidiOutput';
          payload: { trackId: string; expected: string | null; replacement: string | null };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementTrack: ArrangementTrackAppAction;
    }
}
