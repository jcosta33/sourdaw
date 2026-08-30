export type SectionRenderFollowUpFailureKind = 'retention-capacity' | 'review-required' | 'render-incomplete';
export type SectionRenderFollowUpRemediation = 'reconcile' | 'manual-repair';

export class SectionRenderFollowUpError extends Error {
    readonly pendingEffect: {
        kind: 'external-effect';
        remediation: SectionRenderFollowUpRemediation;
        reason: string;
        state: 'pending';
    };

    readonly failureKind: SectionRenderFollowUpFailureKind;

    constructor(input: {
        failureKind: SectionRenderFollowUpFailureKind;
        reason: string;
        remediation: SectionRenderFollowUpRemediation;
    }) {
        super(input.reason);
        this.name = 'SectionRenderFollowUpError';
        this.failureKind = input.failureKind;
        this.pendingEffect = {
            kind: 'external-effect',
            remediation: input.remediation,
            reason: input.reason,
            state: 'pending',
        };
    }
}

export class SectionRenderRetentionCapacityError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'SectionRenderRetentionCapacityError';
    }
}
