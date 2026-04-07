import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type InvalidTempoError = AppError<'InvalidTempo', { bpm: number }>;

export const createInvalidTempoError = (bpm: number): InvalidTempoError =>
    createAppError('InvalidTempo', `Tempo ${bpm} BPM is outside the valid range (20–300)`, { bpm });
