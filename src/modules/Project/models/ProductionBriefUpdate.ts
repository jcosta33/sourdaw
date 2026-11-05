import { type ProductionBriefScope } from './ProductionBrief';

/**
 * The bounds a requested brief change is held to. A brief is durable project intent that every later
 * plan reads, so one request may add only a few short entries, and the brief it composes stays small.
 */
export const PRODUCTION_BRIEF_UPDATE_LIMITS = {
    visionMaxLength: 512,
    statementMaxLength: 280,
    referenceLabelMaxLength: 120,
    entriesPerFieldPerUpdate: 8,
    entriesPerFieldInBrief: 32,
} as const;

/** A scope a requested brief entry may name: the whole project, one track, or one section. */
export type ProductionBriefUpdateScope = Extract<ProductionBriefScope, { kind: 'project' | 'track' | 'section' }>;

export type ProductionBriefUpdateStatement = { scope: ProductionBriefUpdateScope; statement: string };

/**
 * What one request asks to change in the brief. The vision is replaced; every list is added to.
 * Locks and decisions are absent on purpose: a request never writes either.
 */
export type ProductionBriefUpdate = {
    vision?: string;
    references?: readonly { label: string }[];
    hardConstraints?: readonly ProductionBriefUpdateStatement[];
    preferences?: readonly ProductionBriefUpdateStatement[];
    sectionGoals?: readonly { sectionId: string; statement: string }[];
    trackRoles?: readonly { trackId: string; role: string }[];
};

export type ProductionBriefUpdateField = keyof ProductionBriefUpdate | 'update';
