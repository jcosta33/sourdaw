import { type GrooveConsumerType, grooveTemplateStore } from '../../stores/grooveTemplateStore';

type GetGrooveAssignmentInput = {
    consumerType: GrooveConsumerType;
    consumerId: string;
};

export function getGrooveAssignment({ consumerType, consumerId }: GetGrooveAssignmentInput) {
    return grooveTemplateStore.value?.assignments.find(
        (assignment) => assignment.consumerType === consumerType && assignment.consumerId === consumerId
    );
}
