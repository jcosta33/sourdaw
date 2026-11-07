export type CommandBatchPostconditionValidation = {
    documentId: string;
    validate(document: Readonly<Record<string, unknown>>): string | null;
};

type CommandBatchExecutionValidation = {
    preparePostconditions():
        | { status: 'rejected'; reason: string }
        | { status: 'ready'; postconditions: CommandBatchPostconditionValidation };
};

export type CommandBatchValidationPreparation =
    | { status: 'rejected'; reason: string }
    | {
          status: 'ready';
          /** Enter the execution's storage scope before its first handler; never enter Automerge.change. */
          prepareExecution():
              { status: 'rejected'; reason: string } | { status: 'ready'; validation: CommandBatchExecutionValidation };
      };
