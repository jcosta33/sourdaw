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
    version: '45.2.3',
    specifier: '45.2.3',
    integrity: 'sha512-Vurzu5UOA5nTGT4LqIwXD16QFGrOZdiXxF+1UP4KNsAOo/YtDcT3/u0jhP4WSwNJ0iLrLDi85hzBJ0arnGDhyw==',
    license: 'MIT',
    repository: 'https://github.com/electron/electron',
    revision: 'd0a18d02058b21ff292e25d5f53f00bd120f2f61',
    licenseSha256: '5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d',
    chromium: {
        version: '156.0.8078.80',
        repository: 'https://chromium.googlesource.com/chromium/src',
        revision: 'fb096c0011f9d50f0a264a9376420cdea9c421e3',
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
            archive: 'electron-v45.2.3-darwin-arm64.zip',
            sha256: '4d7c429064087a47b855d9bd06c76ead4819b7f02b385de232d4a5c37ecef55f',
            noticesSha256: '214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741',
        },
        {
            platform: 'linux',
            arch: 'arm64',
            archive: 'electron-v45.2.3-linux-arm64.zip',
            sha256: '397c060fd9da99ab72b78787d65545b432fcadf13ef6c96658e4f525692aae0f',
            noticesSha256: '214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741',
        },
        {
            platform: 'linux',
            arch: 'x64',
            archive: 'electron-v45.2.3-linux-x64.zip',
            sha256: 'a87fe741f6d121285117e574da6c9a2e65210d410123bbc04713b099add0263b',
            noticesSha256: '214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741',
        },
        {
            platform: 'win32',
            arch: 'x64',
            archive: 'electron-v45.2.3-win32-x64.zip',
            sha256: '489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0',
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
