import type { Track } from '#/modules/Arrangement/stores';

type Send = Track['sends'][number];

type AddSendInput = {
    from: Track;
    to: Track;
    level: number;
    preFader?: boolean;
};

export function addSend(input: AddSendInput): void {
    const send: Send = {
        busId: input.to.id,
        level: input.level,
        preFader: input.preFader ?? false,
    };
    input.from.sends = [...input.from.sends.filter((existingSend) => existingSend.busId !== input.to.id), send];
}
