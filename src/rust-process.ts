import { spawn } from 'node:child_process'
import { createHash, type Hash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { analysisIdentity, sameExecutionIdentity, type ExecutionIdentity } from './identity.ts'
import { projectBindingTarget } from './binding-target.ts'
import type { ActionRequest, Config } from './model.ts'

export const rustToolchain = '1.86.0'
const frameLimit = 1024 * 1024
type Compiler = ExecutionIdentity['compiler']
export type RustTools = Awaited<ReturnType<typeof rustTools>>
export type RustProgram = { file: string; digest: string; fingerprint: string; compiler: Compiler }

function terminate(child: ReturnType<typeof spawn>, group: boolean) {
  if (group && child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* Already reaped. */
    }
  }
  child.kill('SIGKILL')
}

/** Explicit toolchain commands never use candidate Cargo settings or a shell. */
async function command(
  binary: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  env = process.env,
): Promise<string> {
  if (timeoutMs <= 0 || signal?.aborted)
    throw new Error('Rust operation interrupted or deadline expired')
  const child = spawn(binary, args, {
    cwd: tmpdir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let stdout = '',
    stderr = ''
  let failure: Error | undefined
  const kill = () => terminate(child, true)
  const abort = () => {
    failure ??= new Error('Rust operation interrupted')
    kill()
  }
  const timer = setTimeout(() => {
    failure ??= new Error('Rust feedback deadline expired')
    kill()
  }, timeoutMs)
  signal?.addEventListener('abort', abort, { once: true })
  process.once('exit', kill)
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
    if (Buffer.byteLength(stdout) > 2 * frameLimit) {
      failure ??= new Error('Rust command output exceeded 2 MiB')
      kill()
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    if (Buffer.byteLength(stderr) > 65536) {
      failure ??= new Error('Rust diagnostics exceeded 64 KiB')
      kill()
    }
  })
  child.once('error', (error) => {
    failure ??= error
  })
  try {
    const code = await new Promise<number | null>((done) => child.once('close', done))
    if (failure) throw failure
    if (code !== 0)
      throw new Error('Rust command failed: ' + args.join(' ') + '\n' + stderr.slice(-4096))
    return stdout.trim()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    process.removeListener('exit', kill)
  }
}

function hashFile(
  hash: Hash,
  label: string,
  file: string,
  remaining: () => number,
  buffer: Buffer,
) {
  remaining()
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Rust identity requires a regular file: ' + file)
  hash.update(JSON.stringify([label, stat.size]) + '\n')
  if (stat.size <= buffer.length) {
    hash.update(readFileSync(file))
    return
  }
  const descriptor = openSync(file, 'r')
  try {
    let bytes: number
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null))) {
      remaining()
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    closeSync(descriptor)
  }
}

function hashDirectory(
  hash: Hash,
  directory: string,
  remaining: () => number,
  buffer: Buffer,
  relative = '',
) {
  for (const stat of readdirSync(join(directory, relative), { withFileTypes: true }).sort(
    (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  )) {
    remaining()
    const local = relative ? relative + '/' + stat.name : stat.name
    const path = join(directory, local)
    if (stat.isSymbolicLink())
      throw new Error('Rust sysroot identity cannot contain symlinks: ' + local)
    if (stat.isDirectory()) hashDirectory(hash, directory, remaining, buffer, local)
    else if (stat.isFile()) hashFile(hash, directory + '/' + local, path, remaining, buffer)
  }
}

export async function rustTools(
  signal?: AbortSignal,
  timeoutMs = 30000,
  projectRoot = process.cwd(),
) {
  const began = performance.now()
  const remaining = () => {
    const value = timeoutMs - (performance.now() - began)
    if (value <= 0 || signal?.aborted)
      throw new Error('Rust operation interrupted or deadline expired')
    return value
  }
  const name = process.platform === 'win32' ? 'rustup.exe' : 'rustup'
  const candidate = realpathSync(projectRoot)
  const outside = (file: string) => {
    const path = relative(candidate, realpathSync(file))
    return path === '..' || path.startsWith('..' + sep) || isAbsolute(path)
  }
  const directories = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(isAbsolute)
    .filter((directory) => existsSync(directory) && outside(directory))
    .map((directory) => realpathSync(directory))
  const rustup = directories
    .map((directory) => join(directory, name))
    .find((file) => existsSync(file) && outside(file))
  if (!rustup)
    throw new Error(
      'Standalone Rust needs installed Rust ' +
        rustToolchain +
        ' with rust-analyzer and rust-src; install with rustup toolchain install ' +
        rustToolchain +
        ' --profile minimal --component rust-analyzer --component rust-src',
    )
  const tool = async (name: string) =>
    realpathSync(
      await command(
        realpathSync(rustup),
        ['which', '--toolchain', rustToolchain, name],
        remaining(),
        signal,
      ),
    )
  let rustc: string, analyzer: string
  try {
    ;[rustc, analyzer] = await Promise.all([tool('rustc'), tool('rust-analyzer')])
  } catch (error) {
    throw new Error(
      'Install the optional Rust ' +
        rustToolchain +
        ' rust-analyzer/rust-src components: ' +
        String(error),
    )
  }
  if (!outside(rustc) || !outside(analyzer))
    throw new Error('Rust tools must be installed outside the candidate project')
  const env: NodeJS.ProcessEnv = {
    PATH: directories.join(delimiter),
    ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
  }
  const [compilerVersion, analyzerVersion, root, targetLibrary, cfgText] = await Promise.all([
    command(rustc, ['--version'], remaining(), signal, env),
    command(analyzer, ['--version'], remaining(), signal, env),
    command(rustc, ['--print', 'sysroot'], remaining(), signal, env),
    command(rustc, ['--print', 'target-libdir'], remaining(), signal, env),
    command(rustc, ['--print', 'cfg'], remaining(), signal, env),
  ])
  if (
    !compilerVersion.startsWith('rustc 1.86.0 (05f9846f8 ') ||
    !analyzerVersion.startsWith('rust-analyzer 1.86.0 (05f9846 ')
  )
    throw new Error('Standalone Rust requires the pinned Rust 1.86.0 component versions')
  const sysroot = realpathSync(root)
  const source = join(sysroot, 'lib/rustlib/src/rust/library')
  if (!existsSync(source)) throw new Error('Install rust-src for Rust ' + rustToolchain)
  const cfg = cfgText.split('\n').sort()
  const hash = createHash('sha256').update('bonsai-standalone-rust-v1\0')
  hash.update(
    JSON.stringify({
      rustc,
      analyzer,
      sysroot,
      cfg,
      edition: '2021',
      profile: 'dev',
      features: [],
      cachePrimingThreads: 1,
    }),
  )
  // Reuse scratch space across the thousands of files in this fresh capture.
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  hashFile(hash, 'rustc', rustc, remaining, buffer)
  hashFile(hash, 'rust-analyzer', analyzer, remaining, buffer)
  // rustc's actual driver/shared libraries, target standard library, and RA source
  // are all bound. Cargo registries, build scripts, and plugins are never loaded.
  for (const file of readdirSync(join(sysroot, 'lib')).sort())
    if (/\.(?:so(?:\..*)?|dylib|dll)$/.test(file))
      hashFile(hash, 'driver/' + file, join(sysroot, 'lib', file), remaining, buffer)
  hashDirectory(hash, realpathSync(targetLibrary), remaining, buffer)
  hashDirectory(hash, source, remaining, buffer)
  const compiler: Compiler = {
    name: 'rust-analyzer',
    version: 'standalone-rust-v1/' + compilerVersion + '/' + analyzerVersion,
    digest: hash.digest('hex'),
  }
  remaining()
  return {
    rustc,
    analyzer,
    sysroot,
    source,
    cfg,
    env,
    compiler,
    command: (args: string[]) => command(rustc, args, remaining(), signal, env),
  }
}

export async function standaloneRustIdentity(
  signal?: AbortSignal,
  timeoutMs?: number,
  root?: string,
) {
  return analysisIdentity((await rustTools(signal, timeoutMs, root)).compiler)
}

/** The authored harness is checker source and therefore remains retained cost. */
function harness(bindings: string) {
  return (
    'include!(' +
    JSON.stringify(bindings) +
    ');\n' +
    String.raw`
mod __bonsai_transport {
    use std::io::{self, Read, Write};
    const LIMIT: usize = 1048576;
    fn read(input: &mut impl Read) -> io::Result<Option<String>> {
        let mut length = [0u8; 4];
        match input.read_exact(&mut length) {
            Ok(()) => {},
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(error) => return Err(error),
        }
        let size = u32::from_be_bytes(length) as usize;
        if size > LIMIT { return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large")); }
        let mut bytes = vec![0; size];
        input.read_exact(&mut bytes)?;
        String::from_utf8(bytes).map(Some).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
    fn write(output: &mut impl Write, value: &str) -> io::Result<()> {
        if value.len() > LIMIT { return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large")); }
        output.write_all(&(value.len() as u32).to_be_bytes())?;
        output.write_all(value.as_bytes())?;
        output.flush()
    }
    pub fn run() -> io::Result<()> {
        let mut input = io::stdin().lock();
        let result_path = read(&mut input)?.ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing result path"))?;
        let mut operations = Vec::new();
        let mut input_bytes = result_path.len() + 4;
        while let Some(name) = read(&mut input)? {
            let payload = read(&mut input)?.ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing input"))?;
            input_bytes += name.len() + payload.len() + 8;
            if input_bytes > 16 * LIMIT { return Err(io::Error::new(io::ErrorKind::InvalidData, "plan too large")); }
            operations.push((name, payload));
        }
        drop(input);
        // Bootstrap is exhausted before candidate registration or handlers execute.
        // stdout is a sink, never an authoritative result descriptor.
        let actions: &[(&str, fn(&str) -> String)] = crate::actions();
        let mut results = Vec::new();
        let mut result_bytes = 0;
        for (name, payload) in operations {
            let handler = actions.iter().find(|(key, _)| *key == name)
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "unbound action"))?.1;
            let value = handler(&payload);
            if value.len() > LIMIT { return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large")); }
            result_bytes += value.len() + 4;
            if result_bytes > 16 * LIMIT { return Err(io::Error::new(io::ErrorKind::InvalidData, "result plan too large")); }
            results.push(value);
        }
        // No result descriptor exists until every handler has returned.
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options.open(result_path)?;
        for value in results { write(&mut output, &value)?; }
        Ok(())
    }
}
fn main() { if __bonsai_transport::run().is_err() { std::process::exit(1); } }
`
  )
}

/** Compile once in the verifier, never as part of read-only source analysis. */
export async function prepareRustProgram(
  root: string,
  config: Config,
  fingerprint: string,
  compiler: Compiler,
  timeoutMs: number,
  signal?: AbortSignal,
  checkedContext?: RustTools,
) {
  const target = projectBindingTarget(root, config, fingerprint)
  const tools = checkedContext ?? await rustTools(signal, timeoutMs, root)
  if (!sameExecutionIdentity(analysisIdentity(compiler), analysisIdentity(tools.compiler)))
    throw new Error('Rust toolchain changed before compilation')
  const directory = mkdtempSync(join(tmpdir(), 'bonsai-rust-program-'))
  const file = join(directory, process.platform === 'win32' ? 'application.exe' : 'application')
  const source = join(directory, 'harness.rs')
  try {
    writeFileSync(source, harness(realpathSync(resolve(root, target.file))), { mode: 0o600 })
    await tools.command([
      '--edition=2021',
      '--crate-name',
      'bonsai_application',
      '--sysroot',
      tools.sysroot,
      '-C',
      'opt-level=0',
      '-C',
      'debuginfo=0',
      '-C',
      'panic=abort',
      '--cap-lints',
      'allow',
      source,
      '-o',
      file,
    ])
    projectBindingTarget(root, config, fingerprint)
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
    const program: RustProgram = { file, digest, fingerprint, compiler }
    return {
      program,
      close: async () => {
        rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

/** Native handlers return a completed plan; stdout cannot impersonate return values. */
export async function rustActions(
  root: string,
  config: Config,
  fingerprint: string,
  compiler: Compiler | undefined,
  program: RustProgram | undefined,
  requests: ActionRequest[],
) {
  projectBindingTarget(root, config, fingerprint)
  if (
    !program ||
    !compiler ||
    compiler.name !== 'rust-analyzer' ||
    program.fingerprint !== fingerprint ||
    !sameExecutionIdentity(analysisIdentity(compiler), analysisIdentity(program.compiler)) ||
    createHash('sha256').update(readFileSync(program.file)).digest('hex') !== program.digest
  )
    throw new Error('Invalid compiled Rust application receipt')
  const execute = async (): Promise<unknown[]> => {
    // The verifier owns the enclosing compiled-artifact directory and removes it
    // even if an application worker is killed before its local finally can run.
    const directory = mkdtempSync(join(dirname(program.file), 'results-'))
    const path = join(directory, 'result')
    const child = spawn(program.file, [], { cwd: root, stdio: ['pipe', 'ignore', 'ignore'] })
    const closed = new Promise<void>((done) => child.once('close', () => done()))
    const kill = () => terminate(child, false)
    process.once('exit', kill)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const frames: Buffer[] = []
      let inputBytes = 0
      const frame = (value: string) => {
        const body = Buffer.from(value)
        if (body.length > frameLimit) throw new Error('Rust application input exceeded 1 MiB')
        inputBytes += body.length + 4
        if (inputBytes > 16 * frameLimit) throw new Error('Rust action plan input exceeded 16 MiB')
        const header = Buffer.alloc(4)
        header.writeUInt32BE(body.length)
        frames.push(header, body)
      }
      frame(path)
      for (const request of requests) {
        frame(request.action)
        frame(JSON.stringify(request.input))
      }
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          kill()
          reject(new Error('Rust feedback deadline expired'))
        }, config.policy.maxFeedbackMs)
        child.once('error', reject)
        child.stdin!.on('error', reject)
        child.once('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error('Rust process exited without a completed action plan')),
        )
        child.stdin!.end(Buffer.concat(frames))
      })
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * frameLimit)
        throw new Error('Invalid Rust completed result')
      const bytes = readFileSync(path)
      const values: unknown[] = []
      let offset = 0
      while (offset < bytes.length) {
        if (offset + 4 > bytes.length) throw new Error('Truncated Rust result frame')
        const size = bytes.readUInt32BE(offset)
        offset += 4
        if (size > frameLimit || offset + size > bytes.length)
          throw new Error('Invalid Rust result frame size')
        values.push(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + size)),
            (_key, value) =>
              typeof value === 'number' &&
              (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
                ? Symbol('Rust integer outside the exact JSON safe range')
                : value,
          ),
        )
        offset += size
      }
      if (values.length !== requests.length) throw new Error('Incomplete Rust action plan')
      return values
    } finally {
      clearTimeout(timer)
      kill()
      await closed
      process.removeListener('exit', kill)
      rmSync(directory, { recursive: true, force: true })
    }
  }
  let completed: Promise<unknown[]> | undefined
  let next = 0
  const actions: Record<string, (input: unknown) => Promise<unknown>> = Object.create(null)
  for (const request of requests) {
    const name = request.action
    actions[name] = async (input) => {
      const expected = requests[next]
      if (
        !expected ||
        expected.action !== name ||
        JSON.stringify(expected.input) !== JSON.stringify(input)
      )
        throw new Error('Rust action order or input changed')
      const index = next++
      completed ??= execute()
      return (await completed)[index]
    }
  }
  return actions
}
