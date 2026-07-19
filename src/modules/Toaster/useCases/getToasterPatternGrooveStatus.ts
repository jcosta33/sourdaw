import { canonicalizeGrooveConsumerId, type GrooveTemplateState } from '#/modules/MIDI/stores';
import {
    adaptGrooveTemplateForConsumer,
    getScopedGrooveConsumerId,
    getStraightGrooveTemplateId,
} from '#/modules/MIDI/useCases';

type AdapterFailureError = Extract<ReturnType<typeof adaptGrooveTemplateForConsumer>, { ok: false }>['error'];

export type ToasterPatternGrooveStatus =
    | { status: 'state-unavailable' }
    | { status: 'unassigned' }
    | { status: 'invalid-consumer' }
    | { status: 'missing-template'; templateId: string }
    | {
          status: 'unsupported';
          templateId: string;
          templateName: string;
          error: AdapterFailureError;
      }
    | {
          status: 'ready';
          templateId: string;
          templateName: string;
          amount: number;
      };

type GetToasterPatternGrooveStatusInput = {
    deviceId: string;
    patternId: string;
    stepsPerBar: number;
    grooveState: GrooveTemplateState | undefined;
};

function getSupportedSubdivisions(
    stepsPerBar: number
): Parameters<typeof adaptGrooveTemplateForConsumer>[0]['supportedSubdivisions'] {
    if (stepsPerBar === 16) {
        return ['1/16'];
    }
    if (stepsPerBar === 32) {
        return ['1/32'];
    }
    return [];
}

export function getToasterPatternGrooveStatus({
    deviceId,
    patternId,
    stepsPerBar,
    grooveState,
}: GetToasterPatternGrooveStatusInput): ToasterPatternGrooveStatus {
    if (!grooveState) {
        return { status: 'state-unavailable' };
    }
    const canonicalPatternId = canonicalizeGrooveConsumerId(patternId);
    if (!canonicalPatternId) {
        return { status: 'invalid-consumer' };
    }

    let scopedConsumerId: string;
    try {
        scopedConsumerId = getScopedGrooveConsumerId({ ownerId: deviceId, localId: patternId });
    } catch {
        return { status: 'invalid-consumer' };
    }
    const scopedAssignment = grooveState.assignments.find(
        (candidate) => candidate.consumerType === 'toaster-pattern' && candidate.consumerId === scopedConsumerId
    );
    const legacyAssignment = grooveState.assignments.find(
        (candidate) => candidate.consumerType === 'toaster-pattern' && candidate.consumerId === canonicalPatternId
    );
    const assignment = scopedAssignment ?? legacyAssignment;
    if (!assignment) {
        return { status: 'unassigned' };
    }

    const template = grooveState.templates.find((candidate) => candidate.id === assignment.templateId);
    if (!template) {
        return { status: 'missing-template', templateId: assignment.templateId };
    }
    if (assignment.amount === 0 || template.id === getStraightGrooveTemplateId()) {
        return {
            status: 'ready',
            templateId: template.id,
            templateName: template.name,
            amount: assignment.amount,
        };
    }
    const adaptation = adaptGrooveTemplateForConsumer({
        consumer: 'toaster',
        template,
        supportsDynamics: true,
        supportedSubdivisions: getSupportedSubdivisions(stepsPerBar),
    });
    if (!adaptation.ok) {
        return {
            status: 'unsupported',
            templateId: template.id,
            templateName: template.name,
            error: adaptation.error,
        };
    }
    return {
        status: 'ready',
        templateId: template.id,
        templateName: template.name,
        amount: assignment.amount,
    };
}
