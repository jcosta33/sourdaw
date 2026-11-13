export type ElectronReleaseTarget = {
    platform: 'darwin' | 'linux' | 'win32';
    arch: 'arm64' | 'x64';
    archive: string;
    sha256: string;
    noticesSha256: string;
};

export type ElectronRuntimeContract = {
    schemaVersion: 1;
    package: 'electron';
    version: string;
    specifier: string;
    integrity: string;
    license: 'MIT';
    repository: string;
    revision: string;
    licenseSha256: string;
    chromium: {
        version: string;
        repository: string;
        revision: string;
    };
    node: {
        version: string;
        repository: string;
        revision: string;
    };
    ffmpeg: {
        repository: string;
        revision: string;
        license: 'LGPL-2.1-or-later';
    };
    targets: ElectronReleaseTarget[];
};

export const ELECTRON_RUNTIME_CONTRACT: ElectronRuntimeContract = {
    schemaVersion: 1,
    package: 'electron',
    version: '45.3.1',
    specifier: '45.3.1',
    integrity: 'sha512-1oYau2B4RXF27Df2fzvrFDJoy8AOSVlgS6gklo6wkLZ/QWJemJCJHkY4+uuacvSFUtR8IimiLukLNFoYP0fmjA==',
    license: 'MIT',
    repository: 'https://github.com/electron/electron',
    revision: '3025e0491e87674c112f7a7d2646292c0efa4599',
    licenseSha256: '5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d',
    chromium: {
        version: '156.0.8078.96',
        repository: 'https://chromium.googlesource.com/chromium/src',
        revision: '2ad9b7f5a86846e0b264090723a6a78964bb84c4',
    },
    node: {
        version: 'v24.22.2',
        repository: 'https://github.com/nodejs/node',
        revision: 'f7f273a9bb6445f6f7fb6349105e7532972045fb',
    },
    ffmpeg: {
        repository: 'https://chromium.googlesource.com/chromium/third_party/ffmpeg',
        revision: '9db86ce5b5b454dfc96c435f9f0723012980c37f',
        license: 'LGPL-2.1-or-later',
    },
    targets: [
        {
            platform: 'darwin',
            arch: 'arm64',
            archive: 'electron-v45.3.1-darwin-arm64.zip',
            sha256: 'ed40f8473a3c62a7c0463bd42f6724ccb8d5919cfdc64e0d9f65f61bdb3fe4d2',
            noticesSha256: '214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741',
        },
        {
            platform: 'linux',
            arch: 'arm64',
            archive: 'electron-v45.3.1-linux-arm64.zip',
            sha256: '98bb5dbdcd5c6daaba6d2de293fe84bfae0ba61eb4288042a13723cf865b060a',
            noticesSha256: '214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741',
        },
        {
            platform: 'linux',
            arch: 'x64',
            archive: 'electron-v45.3.1-linux-x64.zip',
            sha256: 'c61d44206f8bd533d30310840b5baaa7fd0e8421cd711b8d1f719a7a336cbce7',
            noticesSha256: '214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741',
        },
        {
            platform: 'win32',
            arch: 'x64',
            archive: 'electron-v45.3.1-win32-x64.zip',
            sha256: 'd92d1aa4700e3a7e7f174731f5086ebd9c21f9773e642b260160fe0a6ebe12d2',
            noticesSha256: '7dac8267ac6da8d959cfe88f5f055b18a397f10230380b5329125e167bf5639b',
        },
    ],
};

const ARCH_NAMES: Readonly<Record<number, string>> = {
    0: 'ia32',
    1: 'x64',
    2: 'armv7l',
    3: 'arm64',
    4: 'universal',
};

export function electronReleaseTarget(
    platform: string,
    arch: number,
    contract: ElectronRuntimeContract = ELECTRON_RUNTIME_CONTRACT
): ElectronReleaseTarget | undefined {
    const archName = ARCH_NAMES[arch];
    return contract.targets.find((target) => target.platform === platform && target.arch === archName);
}
