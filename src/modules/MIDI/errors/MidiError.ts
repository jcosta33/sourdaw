import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type MidiError = AppError<'Midi'>;

export const createMidiError = (message: string): MidiError =>
    createAppError('Midi', message);
