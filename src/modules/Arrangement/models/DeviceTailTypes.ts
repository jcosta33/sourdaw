/**
 * Declared render-tail capability for a device.
 *
 * Offline export has to know how long a device keeps sounding after its last
 * input so a bounce is not cut off mid-reverb. That used to be a hardcoded
 * two-device switch in the export path, which silently gave every other
 * tail-producing device a tail of zero. A device now declares how its own tail
 * is derived, and the export evaluates the declaration.
 *
 * Pure types only, per this folder's contract.
 */

export type DeviceTailDeclaration =
    /**
     * A constant tail. For devices whose sounding length is fixed by their
     * implementation rather than by any exposed parameter — a baked impulse
     * response, or a decay knob that reaches no audio node.
     */
    | {
          kind: 'fixed';
          seconds: number;
          /** Optional pre-delay parameter, in milliseconds, added to the tail. */
          predelayMsParameterId?: string;
      }
    /**
     * A parameter that already expresses the tail in seconds — reverb decay
     * time, or an amp-envelope release stage.
     */
    | {
          kind: 'decaySeconds';
          parameterId: string;
          defaultSeconds: number;
          /** Optional pre-delay parameter, in milliseconds, added to the tail. */
          predelayMsParameterId?: string;
      }
    /**
     * A normalised control that a named law converts into a tail length. The
     * declaration stays data-only — it names the law rather than holding a
     * function — so descriptors remain plain values.
     */
    | {
          kind: 'mappedDecaySeconds';
          parameterId: string;
          defaultValue: number;
          /** Only law defined today: the Dutch Oven decay curve. */
          law: 'dutch-oven-rt60';
          predelayMsParameterId?: string;
      }
    /**
     * A feedback loop, whose tail is the time it takes to decay to -60 dB:
     * `loopSeconds * ln(0.001) / ln(feedback)`.
     */
    | {
          kind: 'feedbackLoop';
          feedbackParameterId: string;
          defaultFeedback: number;
          /** Feedback is clamped here so a unity/over-unity value cannot yield an infinite tail. */
          maxFeedback: number;
          loopParameterId: string;
          loopUnit: 'ms' | 's';
          defaultLoopSeconds: number;
      }
    /**
     * A feedback loop whose controls live in the device's opaque state chunk
     * rather than the generic automation parameter map. Paths are data-only so
     * the descriptor stays serialisable and the evaluator remains device-neutral.
     */
    | {
          kind: 'stateFeedbackLoop';
          feedbackPath: readonly string[];
          defaultFeedback: number;
          /** Optional lower clamp applied by the DSP before feedback enters the loop. */
          minFeedback?: number;
          maxFeedback: number;
          loopPath?: readonly string[];
          loopUnit: 'ms' | 's';
          defaultLoopSeconds: number;
          /** Optional DSP clamps, expressed in seconds after unit conversion. */
          minLoopSeconds?: number;
          maxLoopSeconds?: number;
          enabledPath?: readonly string[];
          defaultEnabledValue?: number;
          /**
           * Generic parameter that can automate the state-backed enable value.
           * The estimator reserves a zero-snapshot effect only when the caller
           * projects an actual enabled lane targeting this parameter.
           */
          automatableEnabledParameterId?: string;
          /** Reject the opaque state and use declaration defaults when this guard does not match. */
          stateGuard?: { path: readonly string[]; equals: string | number };
      }
    /** Parallel internal effects ring simultaneously, so only the longest counts. */
    | {
          kind: 'parallel';
          tails: readonly DeviceTailDeclaration[];
      };
