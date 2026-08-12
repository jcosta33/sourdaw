import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executableAppActionDescriptors, type ExecutableAppAction } from '../executableAppActionRegistry';
import { getCommandHandler } from '../getCommandHandler';
import { getExecutableCommandRegistrations } from '../getExecutableCommandRegistrations';

describe('command registry completeness', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAudioRenderingHandlers());
        registerHandlerMap(getAutomationHandlers());
        registerHandlerMap(getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }));
        registerHandlerMap(getMidiNoteTransformHandlers());
        registerHandlerMap(getTransportHandlers());
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('derives one complete duplicate-free production registration for every executable command', () => {
        const registrations = getExecutableCommandRegistrations();

        expect(registrations.map((registration) => registration.actionType)).toEqual(
            executableAppActionDescriptors.map((descriptor) => descriptor.actionType)
        );
        expect(new Set(registrations.map((registration) => registration.actionType)).size).toBe(registrations.length);
        for (const registration of registrations) {
            const descriptor = executableAppActionDescriptors.find(
                (candidate) => candidate.actionType === registration.actionType
            );
            expect(registration).toMatchObject({
                runtimeSchema: descriptor?.parameters,
                toolDescription: descriptor?.description,
                targetChecks: descriptor?.targetRules,
                risk: descriptor?.risk,
            });
            expect(registration.handler.execute).toBeTypeOf('function');
            expect(registration.receiptDescription).toBe(registration.handler.describe);
            expect(registration.confirmation.required).toBe(registration.risk !== 'bounded-reversible');
            expect(registration.inverseOrCompensation.undoable).toBe(registration.handler.undoable);
            expect(registration.inverseOrCompensation.describe).toBe(registration.handler.describe);
            expect(registration.inverseOrCompensation.prepareAbort).toBe(registration.handler.prepareAbort);
            expect(registration.inverseOrCompensation.requiresAbortCompensation).toBe(
                registration.handler.requiresAbortCompensation ?? true
            );
        }
        expect(registrations.some((registration) => registration.noOpDetector !== undefined)).toBe(true);
        expect(registrations.some((registration) => registration.inverseOrCompensation.undoable)).toBe(true);
        expect(
            registrations.some((registration) => registration.inverseOrCompensation.prepareAbort !== undefined)
        ).toBe(true);

        const action = {
            type: 'setTrackGain',
            payload: { trackId: 'track-vocal', gain: 0.7, expectedGain: 1 },
        } as const;
        expect(getCommandHandler(action)).toBe(
            registrations.find((registration) => registration.actionType === action.type)?.handler
        );
    });

    it('fails closed when an executable descriptor has no production handler registration', () => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());

        expect(() => getExecutableCommandRegistrations()).toThrow('Executable command is not completely registered');
    });

    it('derives the executable compile-time action union from the canonical descriptor registry', () => {
        type DescriptorActionType = (typeof executableAppActionDescriptors)[number]['actionType'];

        expectTypeOf<ExecutableAppAction>().toMatchTypeOf<AppAction>();
        expectTypeOf<ExecutableAppAction['type']>().toEqualTypeOf<DescriptorActionType>();
    });
});
