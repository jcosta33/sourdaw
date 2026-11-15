import { type AgentTrustCeiling } from './AgentExecutionMode';
import { type AgentRunProviderProposal } from './AgentRun';
import { type ProjectContextProductionBrief } from './ProjectContext';

/** One reading the provider offered of an ambiguous brief request: a name and the characters it stands for. */
export type BriefMixAlternative = {
    name: string;
    requestedDescriptors: readonly string[];
};

/** A reading as the brief card carries it, with an id unique within that card. */
export type BriefReading = {
    id: string;
    name: string;
    descriptors: readonly string[];
};

/** What the planner reports when a brief request admitted more than one reading. */
export type BriefReadingOffer = {
    catalogId: string;
    /** The metric state the brief card was planned with, which the chosen reading's card is compiled with again. */
    metricGoalState: string;
    readings: readonly BriefReading[];
    /** The whole next brief the card writes, which each reading's plan is read against. */
    brief: ProjectContextProductionBrief;
    /**
     * What the card's own planning recorded on the run plan beside the metric state, kept so the chosen
     * reading's plan is recorded as the directly planned brief's would be.
     */
    providerProposal?: AgentRunProviderProposal;
    terminalMeasurementSettlement?: string;
};

/** What a brief card carries: the offer, and the ceiling its request ran under, which the chosen reading's batches keep. */
export type BriefReadings = BriefReadingOffer & {
    trustCeiling: AgentTrustCeiling | null;
};
