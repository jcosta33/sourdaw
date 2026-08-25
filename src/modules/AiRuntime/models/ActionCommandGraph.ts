export type ActionCommandGraph = {
    dependenciesByActionIndex: readonly (readonly number[])[];
    batchLocalBindings: readonly {
        bindingId: string;
        producerActionIndex: number;
        producerArgument: string;
    }[];
};
