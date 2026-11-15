/** Structural mirror of Yeast's `NoteSelector`. Kept structural, like every other
 *  snapshot here, so this neutral contract does not depend on a model owned by the
 *  Yeast module. */
export type YeastArpNoteSelectorSnapshot =
    | { readonly type: 'next' }
    | { readonly type: 'previous' }
    | { readonly type: 'index'; readonly index: number }
    | { readonly type: 'random' }
    | { readonly type: 'lowest' }
    | { readonly type: 'highest' };

/** Structural mirror of Yeast's `ArpStep` — one step of a custom arpeggiator
 *  pattern. Kept structural for the same reason the selector above is. */
export type YeastArpStepSnapshot = {
    readonly active: boolean;
    readonly stepType: 'note' | 'rest' | 'tie' | 'chord' | 'random';
    readonly noteSelector: YeastArpNoteSelectorSnapshot;
    readonly velocity: number;
    readonly velocityOverride: boolean;
    readonly gateMul: number;
    readonly octaveOffset: number;
    readonly semitoneOffset: number;
    readonly probability: number;
    readonly ratchet: number;
};

/** Structural mirror of Yeast's `ProcessorType` catalog union. Keep in sync with
 *  `ProcessorCatalog.ProcessorType`; a new processor kind must be added here too,
 *  or the generated argument schema rejects the kind's every action payload. */
export type YeastProcessorTypeSnapshot =
    | 'arpeggiator'
    | 'chord'
    | 'chordMemory'
    | 'scale'
    | 'harmonizer'
    | 'repeater'
    | 'velocity'
    | 'humanizer'
    | 'filter'
    | 'transposer'
    | 'groove'
    | 'ccGenerator'
    | 'euclidean'
    | 'markov'
    | 'mutation';

/** Structural mirror of one Yeast rack processor — the whole `YeastProcessorInfo`
 *  a remove-inverse carries to re-insert the exact processor it deleted. Kept
 *  structural for the same reason every other snapshot here is. */
export type YeastProcessorSnapshot = {
    readonly id: string;
    readonly type: YeastProcessorTypeSnapshot;
    readonly name: string;
    readonly bypassed: boolean;
    readonly params?: Record<string, number>;
};

/** Structural mirror of MIDI's groove-consumer union. Keep in sync with
 *  `GrooveTemplateState.GrooveConsumerType`; a new consumer kind must be added
 *  here too, or the generated argument schema rejects payloads carrying it. */
export type GrooveConsumerTypeSnapshot = 'clip' | 'yeast-processor' | 'toaster-pattern' | 'arpeggiator' | 'sequencer';

/** Structural mirror of MIDI's `GrooveTemplateAssignment` — one groove-template
 *  binding. `removeYeastProcessor` captures its processor's live bindings so the
 *  restore inverse can re-assign them without dispatching a nested undoable assign
 *  action. Kept structural for the same reason every other snapshot here is. */
export type YeastGrooveAssignmentSnapshot = {
    readonly consumerType: GrooveConsumerTypeSnapshot;
    readonly consumerId: string;
    readonly templateId: string;
    readonly amount: number;
};

export type YeastAppAction =
    | {
          /**
           * Guarded, undoable write of one Yeast processor parameter. `expectedValue`
           * optimistic-locks the parameter's current value: `undefined` asserts nothing
           * (fresh user intent over any current state), a number expects itself, so a
           * peer edit to this same parameter between snapshot and admission conflicts
           * instead of being silently overwritten. Self-inverse — the inverse writes
           * the expected value back under the same guard. Per-key only: a peer edit to
           * a DIFFERENT processor or parameter never blocks this undo (#2111).
           * The groove processor's `amount` parameter is deliberately NOT routed here —
           * it is owned by `assignGrooveTemplate` (already undoable); writing it through
           * this action too would record the same gesture twice.
           */
          type: 'setYeastProcessorParam';
          payload: { processorId: string; paramId: string; value: number; expectedValue?: number };
      }
    | {
          /**
           * Guarded, undoable write of one arpeggiator's custom step pattern. The
           * guards compare the DECODED `pattern_*` subset only, so a peer editing a
           * different parameter of the same processor never blocks this undo. A whole
           * pattern is one edit unit: step-velocity paint strokes dispatch once per
           * cell and coalesce into one undo group (#2111). Self-inverse — the inverse
           * restores the prior steps under the same decoded-subset guard.
           */
          type: 'setYeastArpPattern';
          payload: {
              processorId: string;
              steps: readonly YeastArpStepSnapshot[];
              expectedSteps?: readonly YeastArpStepSnapshot[];
          };
      }
    | {
          /** Guarded self-inverse of one Yeast processor's bypass toggle; `muteTrack`
           *  shape. `expectedBypassed` is required: a bypass write always knows the
           *  state it replaces. */
          type: 'setYeastProcessorBypass';
          payload: { processorId: string; bypassed: boolean; expectedBypassed: boolean };
      }
    | {
          /**
           * Undoable creation of one Yeast rack processor. `processorId` is
           * application-owned and materialized before dispatch so replay is
           * deterministic — UUID minting moved to the call site (#2111). Its undo
           * inverse is a guarded `removeYeastProcessor`; the same handler also serves
           * the guarded restore leg of `removeYeastProcessor` through the internal
           * `restore` metadata, which provider payloads cannot set.
           */
          type: 'addYeastProcessor';
          payload: {
              processorId: string;
              type: YeastProcessorTypeSnapshot;
              name: string;
              /** Internal replay metadata for removeYeastProcessor's inverse. */
              restore?: {
                  readonly processor: YeastProcessorSnapshot;
                  readonly atIndex: number;
                  /** Groove assignments captured before the removal deleted them;
                   *  the restore leg re-binds them directly, never as a nested
                   *  undoable dispatch. */
                  readonly grooveAssignments?: readonly YeastGrooveAssignmentSnapshot[];
              };
          };
      }
    | {
          /**
           * Guarded, undoable removal of one Yeast rack processor. The guards carry
           * the whole expected processor and its index, so the undo inverse can
           * re-insert exactly what was deleted, and a peer edit inside that processor
           * between snapshot and undo conflicts instead of being silently dropped.
           * Removal also deletes the processor's groove assignments in the groove
           * store; the inverse payload carries the captured assignments so the
           * restore re-binds them (#4124).
           */
          type: 'removeYeastProcessor';
          payload: { processorId: string; expectedProcessor: YeastProcessorSnapshot; expectedIndex: number };
      }
    | {
          /**
           * Guarded, undoable move of one Yeast rack processor to `toIndex`. The
           * guard compares the rack's processor-id SEQUENCE only, so a peer editing a
           * parameter never blocks this undo — and the inverse is self-inverse,
           * moving the processor back guarded on the post-move sequence.
           */
          type: 'reorderYeastProcessor';
          payload: { processorId: string; toIndex: number; expectedOrder: readonly string[] };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        yeast: YeastAppAction;
    }
}
