/** App-only addresses of complete candidate facts printed in this exact request. */
export type PlanningContextObject = {
    reference: string;
    id: string;
    label: string;
    kind: string;
    parentId: string | null;
    startBeat: number | null;
    endBeat: number | null;
};
export type PlanningContextSection = {
    reference: string;
    /** Internal identity is deliberately absent from the provider's section rows. */
    id: string;
    label: string;
    startBeat: number;
    endBeat: number;
};
export type PlanningContextBinding = {
    authorityComplete: boolean;
    snapshotIdentity: string;
    mode: 'full' | 'delta';
    revision: string | null;
    selection: { trackId: string | null; clipId: string | null; clipIds: string[] };
    objects: PlanningContextObject[];
    sections: PlanningContextSection[];
};
