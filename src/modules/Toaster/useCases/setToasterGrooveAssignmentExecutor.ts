import {
    toasterGrooveAssignmentExecutorState,
    type ToasterGrooveAssignmentExecutor,
} from './toasterGrooveAssignmentExecutorState';

export function setToasterGrooveAssignmentExecutor(input: { execute: ToasterGrooveAssignmentExecutor }): void {
    toasterGrooveAssignmentExecutorState.execute = input.execute;
}
