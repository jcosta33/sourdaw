import { type RuntimeAction } from '../models/RuntimeAction';

export type LlmActionRejection = {
    index: number;
    name: string;
    reason: string;
};

export type LlmActionBridgeResult = {
    actions: RuntimeAction[];
    rejections: LlmActionRejection[];
};

export type MarkerPlanningSignature = {
    beat: number;
    color?: string;
    markerId?: string;
    name: string;
};

export type SectionPlanningSignature = {
    endBeat: number;
    name: string;
    sectionId?: string;
    startBeat: number;
};
