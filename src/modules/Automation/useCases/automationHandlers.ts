import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { scaleAutomationValues } from '#/modules/Automation/useCases/automation/scaleAutomationValues';
import { stretchAutomationTime } from '#/modules/Automation/useCases/automation/stretchAutomationTime';
import { invertAutomation } from '#/modules/Automation/useCases/automation/invertAutomation';
import { reverseAutomation } from '#/modules/Automation/useCases/automation/reverseAutomation';
import { thinAutomationPoints } from '#/modules/Automation/useCases/automation/thinAutomationPoints';
import { quantizeAutomationBeats } from '#/modules/Automation/useCases/automation/quantizeAutomationBeats';

type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeScaleAutomation = inject({ scaleAutomationValues })(
    ({ scaleAutomationValues }) =>
        function executeScaleAutomation(a: ExtractAction<AppAction, 'scaleAutomation'>): void {
            scaleAutomationValues(a.payload.laneId, a.payload.factor, a.payload.anchor);
        }
);

export const executeStretchAutomation = inject({ stretchAutomationTime })(
    ({ stretchAutomationTime }) =>
        function executeStretchAutomation(a: ExtractAction<AppAction, 'stretchAutomation'>): void {
            stretchAutomationTime(a.payload.laneId, a.payload.factor, a.payload.anchorBeat);
        }
);

export const executeInvertAutomation = inject({ invertAutomation })(
    ({ invertAutomation }) =>
        function executeInvertAutomation(a: ExtractAction<AppAction, 'invertAutomation'>): void {
            invertAutomation(a.payload.laneId);
        }
);

export const executeReverseAutomation = inject({ reverseAutomation })(
    ({ reverseAutomation }) =>
        function executeReverseAutomation(a: ExtractAction<AppAction, 'reverseAutomation'>): void {
            reverseAutomation(a.payload.laneId);
        }
);

export const executeThinAutomation = inject({ thinAutomationPoints })(
    ({ thinAutomationPoints }) =>
        function executeThinAutomation(a: ExtractAction<AppAction, 'thinAutomation'>): void {
            thinAutomationPoints(a.payload.laneId, a.payload.tolerance);
        }
);

export const executeQuantizeAutomation = inject({ quantizeAutomationBeats })(
    ({ quantizeAutomationBeats }) =>
        function executeQuantizeAutomation(a: ExtractAction<AppAction, 'quantizeAutomation'>): void {
            quantizeAutomationBeats(a.payload.laneId, a.payload.gridSize);
        }
);

export const automationHandlers = {
    scaleAutomation: {
        execute: executeScaleAutomation,
        describe: (a) => ({ label: `Scale automation ×${a.payload.factor}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'scaleAutomation'>>,

    stretchAutomation: {
        execute: executeStretchAutomation,
        describe: (a) => ({ label: `Stretch automation ×${a.payload.factor}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'stretchAutomation'>>,

    invertAutomation: {
        execute: executeInvertAutomation,
        describe: () => ({ label: 'Invert automation' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'invertAutomation'>>,

    reverseAutomation: {
        execute: executeReverseAutomation,
        describe: () => ({ label: 'Reverse automation' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'reverseAutomation'>>,

    thinAutomation: {
        execute: executeThinAutomation,
        describe: () => ({ label: 'Thin automation points' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'thinAutomation'>>,

    quantizeAutomation: {
        execute: executeQuantizeAutomation,
        describe: (a) => ({ label: `Quantize automation to ${a.payload.gridSize} beats` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'quantizeAutomation'>>,
};
