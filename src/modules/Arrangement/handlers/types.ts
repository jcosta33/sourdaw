import { type AppAction } from '#/modules/Command/useCases';

export type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
