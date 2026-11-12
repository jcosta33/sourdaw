import { BasicPitch } from '@spotify/basic-pitch';
import modelUrl from 'virtual:sourdaw-basic-pitch-model';

export async function loadBasicPitchModel(): Promise<BasicPitch> {
    const instance = new BasicPitch(modelUrl);
    await instance.model;
    return instance;
}
