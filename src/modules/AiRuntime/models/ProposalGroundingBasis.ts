/** One provider call exactly as the request text it was grounded in admitted it. */
export type ProposalGroundingCall = {
    name: string;
    arguments: Record<string, unknown>;
};

/**
 * A request text and the calls it grounded. Grounding is replayed from this pair rather than from a
 * stored clause span, so a later refinement re-resolves each target through the same scope rules
 * that admitted it, in the project as it is then.
 */
export type ProposalGroundingSource = {
    text: string;
    calls: ProposalGroundingCall[];
};

/** How a command's one numeric value was stated: where it lands, or how far it moves. */
export type ProposalGroundingValue = {
    argument: string;
    value: number;
    form: 'absolute' | 'relative';
    /** `dB` for a level stated in decibels; `null` for every other numeric value. */
    unit: 'dB' | null;
};

export type ProposalGroundingTarget = {
    argument: string;
    id: string;
};

export type ProposalGroundingCommand = {
    type: string;
    /** The command's arguments as grounded, before state guards add their expectations. */
    payload: Record<string, unknown>;
    /** Every target argument the action registry declares for this type, in registry order. */
    targets: ProposalGroundingTarget[];
    /** Which source's text grounded this command's target, and at which call of that source. */
    source: number;
    sourceCallIndex: number;
    value: ProposalGroundingValue | null;
};

/**
 * What an ordinary pending card was grounded in, kept so a terse refinement can inherit it. Authority
 * is never read from the provider: the sources are request texts the user typed, the first one the
 * request that opened the chain, and the protections are every object any of them protected.
 */
export type ProposalGroundingBasis = {
    rootText: string;
    sources: ProposalGroundingSource[];
    commands: ProposalGroundingCommand[];
    protectedUnchanged: Array<{ id: string; name: string }>;
};
