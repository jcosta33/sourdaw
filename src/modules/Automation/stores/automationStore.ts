import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth';

export type AutomationPoint = {
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension: number;
    stairSteps?: number;
};

export type ClipAutomationMode = 'additive' | 'multiplicative';

export type AutomationObject = {
    id: string;
    laneId: string;
    startBeat: number;
    endBeat: number;
    points: AutomationPoint[];
    poolId?: string;
    loopLength?: number;
    name: string;
};

export type AutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    clipAutomationMode?: ClipAutomationMode;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
    trimPoints?: AutomationPoint[];
    objects: AutomationObject[];
    visible: boolean;
    enabled: boolean;
    collapsed: boolean;
    virginTerritory: boolean;
    minValue: number;
    maxValue: number;
    viewMinValue?: number;
    viewMaxValue?: number;
    color?: string;
};

export type AutomationStoreState = {
    lanes: AutomationLane[];
};

export const automationStore = createStore<AutomationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'automation'),
    initialData: { lanes: [] },
});
