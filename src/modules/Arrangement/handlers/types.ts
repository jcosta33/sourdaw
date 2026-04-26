import { type AppAction } from '#/modules/Command/useCases';

export type ExtractAction<Action extends AppAction, TypeString extends string> = Action extends { type: TypeString }
    ? Action
    : never;
