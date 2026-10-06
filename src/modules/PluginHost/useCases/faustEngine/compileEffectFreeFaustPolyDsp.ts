import { FaustPolyDspGenerator, type IFaustCompiler } from '@grame/faustwasm';

export async function compileEffectFreeFaustPolyDsp(
    compiler: IFaustCompiler,
    name: string,
    code: string,
    args: string
): Promise<FaustPolyDspGenerator | null> {
    const voiceFactory = await compiler.createPolyDSPFactory(name, code, args);
    if (!voiceFactory) {
        return null;
    }

    const voiceMeta = JSON.parse(voiceFactory.json) as { compile_options: string };
    const isDouble = voiceMeta.compile_options.includes('-double');
    const { mixerBuffer, mixerModule } = await compiler.getAsyncInternalMixerModule(isDouble);

    const generator = new FaustPolyDspGenerator();
    generator.name = name;
    generator.voiceFactory = voiceFactory;
    generator.mixerBuffer = mixerBuffer;
    generator.mixerModule = mixerModule;
    return generator;
}
