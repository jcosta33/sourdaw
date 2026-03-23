import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import {
    scaleAutomationValues,
    stretchAutomationTime,
    invertAutomation,
    reverseAutomation,
    thinAutomationPoints,
    quantizeAutomationBeats,
} from '#/modules/Automation/useCases/automationUseCases';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const automationHandlers = {
    scaleAutomation: {
        execute: (a) => {
            scaleAutomationValues(a.payload.laneId, a.payload.factor, a.payload.anchor);
        },
        describe: (a) => ({ label: `Scale automation ×${a.payload.factor}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'scaleAutomation'>>,

    stretchAutomation: {
        execute: (a) => {
            stretchAutomationTime(a.payload.laneId, a.payload.factor, a.payload.anchorBeat);
        },
        describe: (a) => ({ label: `Stretch automation ×${a.payload.factor}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'stretchAutomation'>>,

    invertAutomation: {
        execute: (a) => {
            invertAutomation(a.payload.laneId);
        },
        describe: () => ({ label: 'Invert automation' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'invertAutomation'>>,

    reverseAutomation: {
        execute: (a) => {
            reverseAutomation(a.payload.laneId);
        },
        describe: () => ({ label: 'Reverse automation' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'reverseAutomation'>>,

    thinAutomation: {
        execute: (a) => {
            thinAutomationPoints(a.payload.laneId, a.payload.tolerance);
        },
        describe: () => ({ label: 'Thin automation points' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'thinAutomation'>>,

    quantizeAutomation: {
        execute: (a) => {
            quantizeAutomationBeats(a.payload.laneId, a.payload.gridSize);
        },
        describe: (a) => ({ label: `Quantize automation to ${a.payload.gridSize} beats` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'quantizeAutomation'>>,
};
