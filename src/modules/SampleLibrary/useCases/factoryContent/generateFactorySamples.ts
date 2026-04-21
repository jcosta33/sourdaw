import { generate808Kit } from './drums808';
import { generate909Kit } from './drums909';
import { generateAcousticKit } from './drumsAcoustic';
import { generateLofiKit } from './drumsLofi';
import { generateBassPack } from './bass';
import { generateImpactsPack, generateRisersPack } from './fx';
import { generateKeysPack } from './keys';
import { generateElectronicPerc } from './percElectronic';
import { generateWorldPerc } from './percWorld';
import { type FactorySample } from './types';

export function generateFactorySamples(ctx: AudioContext): FactorySample[] {
    return [
        ...generate909Kit(ctx),
        ...generate808Kit(ctx),
        ...generateAcousticKit(ctx),
        ...generateLofiKit(ctx),
        ...generateWorldPerc(ctx),
        ...generateElectronicPerc(ctx),
        ...generateBassPack(ctx),
        ...generateKeysPack(ctx),
        ...generateRisersPack(ctx),
        ...generateImpactsPack(ctx),
    ];
}
