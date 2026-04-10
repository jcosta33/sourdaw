import { scaleAutomationValues } from './automation/scaleAutomationValues';
import { stretchAutomationTime } from './automation/stretchAutomationTime';
import { invertAutomation } from './automation/invertAutomation';
import { reverseAutomation } from './automation/reverseAutomation';
import { thinAutomationPoints } from './automation/thinAutomationPoints';
import { quantizeAutomationBeats } from './automation/quantizeAutomationBeats';

type AutomationHandlerResult = {
    label: string;
};

type AutomationHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => AutomationHandlerResult;
    undoable: boolean;
};

type AutomationAction =
    | { type: 'scaleAutomation'; payload: { laneId: string; factor: number; anchor?: number } }
    | { type: 'stretchAutomation'; payload: { laneId: string; factor: number; anchorBeat?: number } }
    | { type: 'invertAutomation'; payload: { laneId: string } }
    | { type: 'reverseAutomation'; payload: { laneId: string } }
    | { type: 'thinAutomation'; payload: { laneId: string; tolerance?: number } }
    | { type: 'quantizeAutomation'; payload: { laneId: string; gridSize: number } };

type AutomationActionOf<ActionType extends AutomationAction['type']> = Extract<AutomationAction, { type: ActionType }>;

type AutomationHandlers = {
    scaleAutomation: AutomationHandler<AutomationActionOf<'scaleAutomation'>>;
    stretchAutomation: AutomationHandler<AutomationActionOf<'stretchAutomation'>>;
    invertAutomation: AutomationHandler<AutomationActionOf<'invertAutomation'>>;
    reverseAutomation: AutomationHandler<AutomationActionOf<'reverseAutomation'>>;
    thinAutomation: AutomationHandler<AutomationActionOf<'thinAutomation'>>;
    quantizeAutomation: AutomationHandler<AutomationActionOf<'quantizeAutomation'>>;
};

export const automationHandlers: AutomationHandlers = {
    scaleAutomation: {
        execute: (a) => {
            scaleAutomationValues(a.payload.laneId, a.payload.factor, a.payload.anchor);
        },
        describe: (a) => ({ label: `Scale automation ×${a.payload.factor}` }),
        undoable: true,
    },

    stretchAutomation: {
        execute: (a) => {
            stretchAutomationTime(a.payload.laneId, a.payload.factor, a.payload.anchorBeat);
        },
        describe: (a) => ({ label: `Stretch automation ×${a.payload.factor}` }),
        undoable: true,
    },

    invertAutomation: {
        execute: (a) => {
            invertAutomation(a.payload.laneId);
        },
        describe: () => ({ label: 'Invert automation' }),
        undoable: true,
    },

    reverseAutomation: {
        execute: (a) => {
            reverseAutomation(a.payload.laneId);
        },
        describe: () => ({ label: 'Reverse automation' }),
        undoable: true,
    },

    thinAutomation: {
        execute: (a) => {
            thinAutomationPoints(a.payload.laneId, a.payload.tolerance);
        },
        describe: () => ({ label: 'Thin automation points' }),
        undoable: true,
    },

    quantizeAutomation: {
        execute: (a) => {
            quantizeAutomationBeats(a.payload.laneId, a.payload.gridSize);
        },
        describe: (a) => ({ label: `Quantize automation to ${a.payload.gridSize} beats` }),
        undoable: true,
    },
};
