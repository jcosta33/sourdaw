import { AppError } from '#/helpers/Errors/AppError';

export class InvalidTempoError extends AppError {
    constructor(readonly bpm: number) {
        super(`Tempo ${bpm} BPM is outside the valid range (20–300)`);
    }
}
