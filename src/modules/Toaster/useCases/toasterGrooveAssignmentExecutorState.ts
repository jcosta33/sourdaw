export type AssignToasterGrooveAction = {
    type: 'assignGrooveTemplate';
    payload: {
        consumerType: 'toaster-pattern';
        consumerId: string;
        templateId: string;
        amount: number;
    };
};

export type ToasterGrooveAssignmentExecutor = (action: AssignToasterGrooveAction) => Promise<void>;

function rejectUnconfiguredAssignment(): Promise<void> {
    return Promise.reject(new Error('Toaster groove assignment executor is not configured'));
}

export const toasterGrooveAssignmentExecutorState: {
    execute: ToasterGrooveAssignmentExecutor;
} = { execute: rejectUnconfiguredAssignment };
