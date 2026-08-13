type CommandBatchPostconditionValidation = {
    documentId: string;
    validate(document: Readonly<Record<string, unknown>>): string | null;
};

export type CommandBatchValidationPreparation =
    | { status: 'rejected'; reason: string }
    | {
          status: 'ready';
          postconditions: CommandBatchPostconditionValidation;
      };
