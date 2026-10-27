import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const checkout = fileURLToPath(new URL('../', import.meta.url))
const manifest = require('../package.json') as {
  name: string
  version: string
  dependencies: { tsrs: string }
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

export function nativeRepair(): string {
  const command = existsSync(join(checkout, 'bun.lock'))
    ? `cd ${quote(checkout)} && bun install --frozen-lockfile`
    : `bun add --global ${manifest.name}@${manifest.version} --force`
  return process.env.BONSAI_NATIVE_BINARY === undefined
    ? command
    : `unset BONSAI_NATIVE_BINARY && ${command}`
}

export class NativeInstallError extends Error {
  constructor(
    message: string,
    readonly run = nativeRepair(),
  ) {
    super(message)
    this.name = 'NativeInstallError'
  }
}

/** The pinned distribution supplies these prebuilt targets, without install scripts. */
export function nativePackage(platform: string, arch: string, gnuLoader: boolean): string {
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64'))
    return `@tsrs/linux-${arch}-${gnuLoader ? 'gnu' : 'musl'}`
  if (platform === 'darwin' && arch === 'arm64') return '@tsrs/darwin-arm64'
  throw new NativeInstallError(
    `Rust checker isn't available for ${platform}/${arch}. This release supports Linux x64/arm64 and macOS arm64`,
    'https://github.com/jiggy/bonsai/blob/main/docs/native-prototype.md#install-and-run',
  )
}

/** Resolve from the installed checker, never the candidate or the shell's PATH. */
export function nativeBinary(): string {
  const override = process.env.BONSAI_NATIVE_BINARY
  if (override !== undefined) {
    if (!override.trim() || !existsSync(resolve(override)))
      throw new NativeInstallError(
        `Rust checker executable is unavailable: ${override || '(empty path)'}`,
      )
    return resolve(override)
  }
  const loader =
    process.arch === 'arm64' ? '/lib/ld-linux-aarch64.so.1' : '/lib64/ld-linux-x86-64.so.2'
  // NixOS can lack the GNU binary's ELF interpreter even on a glibc host.
  const selected = nativePackage(process.platform, process.arch, existsSync(loader))
  let compiler: string
  try {
    compiler = require.resolve('tsrs/package.json')
  } catch {
    throw new NativeInstallError(
      `Rust checker dependency tsrs@${manifest.dependencies.tsrs} isn't installed`,
    )
  }
  let directory: string
  try {
    directory = dirname(createRequire(compiler).resolve(`${selected}/package.json`))
  } catch {
    throw new NativeInstallError(
      `Prebuilt Rust checker ${selected} isn't installed. Reinstall Bonsai with optional dependencies enabled`,
    )
  }
  const binary = join(directory, 'tsrs')
  if (!existsSync(binary) || !existsSync(join(directory, 'lib.d.ts')))
    throw new NativeInstallError(
      `Prebuilt Rust checker ${selected} is incomplete. Reinstall Bonsai with optional dependencies enabled`,
    )
  return binary
}
