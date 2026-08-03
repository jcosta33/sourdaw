import { type RuntimeAction } from './RuntimeAction';

type CreateBusRuntimeAction = Extract<RuntimeAction, { type: 'createBus' }>;

export type ExecutableRuntimeAction =
    | Exclude<RuntimeAction, CreateBusRuntimeAction>
    | {
          type: 'createBus';
          payload: CreateBusRuntimeAction['payload'] & { busId?: string };
      };
