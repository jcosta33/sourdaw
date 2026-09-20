import {
    type GrooveConsumerType,
    grooveTemplateStore,
    type GrooveTemplateState,
} from '../../stores/grooveTemplateStore';

type GetGrooveAssignmentInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
};

export function getGrooveAssignment(
    { consumerType, consumerId }: GetGrooveAssignmentInput,
    state: GrooveTemplateState | null = grooveTemplateStore.value
) {
    return state?.assignments.find(
        (assignment) => assignment.consumerType === consumerType && assignment.consumerId === consumerId
    );
}
