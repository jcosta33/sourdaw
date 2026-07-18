/**
 * Routing-local view shape of Arrangement's Track model (AGENTS.md §95 —
 * model isolation). These are NOT re-exports: the routing views read the
 * Arrangement track store as a contract but keep their own narrow view type,
 * so a change to Arrangement's model surfaces as a structural break at the
 * consumption site — the intended signal.
 */

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type Send = {
    busId: string;
    level: number;
    preFader: boolean;
};

export type Track = {
    id: string;
    name: string;
    kind: TrackKind;
    color: string;
    sends: Send[];
    outputId: string;
};
