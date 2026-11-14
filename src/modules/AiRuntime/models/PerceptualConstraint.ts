/**
 * The perceptual constraints the application can hold a batch to. Each names one versioned invariant:
 * the metrics that measure it and, for some, the edits it excludes. `unsupported` records a
 * constraint the request states but no measurement can verify, so the batch carrying it is never
 * approved silently.
 */
export const PERCEPTUAL_CONSTRAINT_IDS = [
    'low-end-untouched-v1',
    'vocal-intimacy-v1',
    'loudness-held-v1',
    'loudness-not-raised-v1',
    'loudness-not-lowered-v1',
    'stereo-width-held-v1',
    'dynamics-held-v1',
    'brightness-held-v1',
    'unsupported',
] as const;

export type PerceptualConstraintId = (typeof PERCEPTUAL_CONSTRAINT_IDS)[number];

/** The constraints that take an edit dimension away from the batch as well as holding their metrics. */
export const EXCLUDING_PERCEPTUAL_CONSTRAINT_IDS = ['low-end-untouched-v1', 'vocal-intimacy-v1'] as const;

/**
 * The constraints held by measurement alone: any edit may reach their scope, and the preview shows
 * whether it kept the measured quality within its tolerance.
 */
export const MEASURED_PERCEPTUAL_CONSTRAINT_IDS = [
    'loudness-held-v1',
    'loudness-not-raised-v1',
    'loudness-not-lowered-v1',
    'stereo-width-held-v1',
    'dynamics-held-v1',
    'brightness-held-v1',
] as const;

/**
 * An edit dimension a constraint takes away from the batch. `low-frequency-band` is every write that
 * shapes content below the low-end crossover; `ambience` is every write that adds or changes the
 * space around a source: reverb, delay, chorus, widening, and the sends that feed a return.
 */
export type PerceptualExcludedDimension = 'low-frequency-band' | 'ambience';

/** The objects a constraint holds: the whole mix, measured at the master, or named tracks. */
export type PerceptualConstraintScope = { kind: 'mix' } | { kind: 'tracks'; trackIds: string[] };

type ConstraintCommon = {
    /** The request's own words for the constraint, quoted back to the user in every refusal. */
    clause: string;
    scope: PerceptualConstraintScope;
};

export type ExcludingPerceptualConstraint = ConstraintCommon & {
    constraintId: (typeof EXCLUDING_PERCEPTUAL_CONSTRAINT_IDS)[number];
    protection: { kind: 'exclude-dimension'; dimension: PerceptualExcludedDimension };
};

export type MeasuredPerceptualConstraint = ConstraintCommon & {
    constraintId: (typeof MEASURED_PERCEPTUAL_CONSTRAINT_IDS)[number];
    protection: { kind: 'measured' };
};

export type PerceptualConstraint = ExcludingPerceptualConstraint | MeasuredPerceptualConstraint;

export type UnsupportedPerceptualConstraint = {
    constraintId: 'unsupported';
    clause: string;
    reason: string;
};

export type PerceptualConstraintReading = {
    constraints: PerceptualConstraint[];
    unsupported: UnsupportedPerceptualConstraint[];
};
