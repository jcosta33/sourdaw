/**
 * Declared render-tail capability for a device (OE-9).
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
      };
