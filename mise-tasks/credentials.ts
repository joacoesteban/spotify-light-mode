import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Result, err, ok } from 'neverthrow'
import { P, match } from 'ts-pattern'

export class CommandFailed extends Error {
  constructor(
    readonly command: string,
    readonly reason: string,
  ) {
    super(`${command} ${reason}.`)
  }
}

export class FileFailed extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}.`)
  }
}

export class MissingValue extends Error {
  constructor(readonly key: string) {
    super(`No value for ${key}.`)
  }
}

export class UnexpectedProfile extends Error {
  constructor(readonly pattern: RegExp) {
    super(`fnox.toml has no line matching ${String(pattern)}; it is unchanged.`)
  }
}

type RunOptions = {
  readonly input?: string
}

type Entry = readonly [key: string, value: string]

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PROFILE = `${ROOT}fnox.toml`

const fileFailed = (path: string) => (cause: unknown) =>
  new FileFailed(path, String(cause))

const listed = (keys: readonly string[]) =>
  match(keys)
    .with([P.string], ([only]) => only)
    .otherwise(
      (all) => `${all.slice(0, -1).join(', ')} and ${all.at(-1) ?? ''}`,
    )

const spawn = (
  command: string,
  args: readonly string[],
  { input }: RunOptions,
  stdout: 'pipe' | 'inherit',
): Result<SpawnSyncReturns<string>, CommandFailed> => {
  const line = [command, ...args].join(' ')

  return match(
    spawnSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['inherit', stdout, 'inherit'],
      input,
    }),
  )
    .with({ error: P.instanceOf(Error) }, ({ error }) =>
      err(new CommandFailed(line, error.message)),
    )
    .with({ status: 0 }, (result) => ok(result))
    .otherwise(({ status, signal }) =>
      err(new CommandFailed(line, `exited with ${String(status ?? signal)}`)),
    )
}

export class Credentials {
  static readonly REPOSITORY = 'JoacoEsteban/spotify-light-mode'
  static readonly ROOT = ROOT

  static readonly log = (message: string) => {
    console.error(message)
  }

  // Secrets reach a command through `input`, never its arguments, which show
  // up in the process list and in CommandFailed.
  static readonly output = (
    command: string,
    args: readonly string[],
    options: RunOptions = {},
  ) => spawn(command, args, options, 'pipe').map(({ stdout }) => stdout.trim())

  static readonly exec = (
    command: string,
    args: readonly string[],
    options: RunOptions = {},
  ) => spawn(command, args, options, 'inherit').map(() => undefined)

  static readonly sequence = <T, U, E>(
    items: readonly T[],
    step: (item: T, index: number) => Result<U, E>,
  ) =>
    items.reduce<Result<U[], E>>(
      (done, item, index) =>
        done.andThen((values) =>
          step(item, index).map((value) => [...values, value]),
        ),
      ok([]),
    )

  static readonly required = (
    key: string,
    value: string,
  ): Result<string, MissingValue> =>
    match(value.trim())
      .with('', () => err(new MissingValue(key)))
      .otherwise((trimmed) => ok(trimmed))

  static readonly read = (
    keys: readonly string[],
  ): Result<string[], CommandFailed | FileFailed | MissingValue> =>
    match(process.stdin.isTTY)
      .with(true, () =>
        Credentials.sequence(keys, (key) =>
          Credentials.output('bash', [
            '-c',
            'read -rsp "$1: " value && echo >&2 && printf %s "$value"',
            'prompt',
            key,
          ]).andThen((value) => Credentials.required(key, value)),
        ),
      )
      .otherwise(() =>
        Result.fromThrowable(
          () => readFileSync(0, 'utf8').split('\n'),
          fileFailed('stdin'),
        )().andThen((lines) =>
          Credentials.sequence(keys, (key, index) => {
            Credentials.log(`Reading ${key} from stdin.`)
            return Credentials.required(key, lines[index] ?? '')
          }),
        ),
      )

  static readonly commit = (files: readonly string[], message: string) => {
    Credentials.log(`Committing ${files.join(' and ')}.`)
    return Credentials.exec('jj', ['commit', ...files, '-m', message])
  }

  static readonly store = (entries: readonly Entry[]) =>
    Credentials.sequence(entries, ([key, value]) => {
      Credentials.log(`Encrypting ${key} into the ci profile.`)
      return Credentials.exec('fnox', ['-P', 'ci', 'set', key], {
        input: value,
      })
    }).andThen(() =>
      Credentials.commit(
        ['fnox.toml'],
        `ci(credentials): store ${listed(entries.map(([key]) => key))}`,
      ),
    )

  static readonly editProfile = (
    pattern: RegExp,
    replacement: string,
  ): Result<void, FileFailed | UnexpectedProfile> =>
    Result.fromThrowable(
      () => readFileSync(PROFILE, 'utf8'),
      fileFailed(PROFILE),
    )().andThen((toml) =>
      match(toml.match(pattern))
        .with(P.nullish, () => err(new UnexpectedProfile(pattern)))
        .otherwise(() =>
          Result.fromThrowable(() => {
            writeFileSync(PROFILE, toml.replace(pattern, replacement))
          }, fileFailed(PROFILE))(),
        ),
    )

  static readonly move = (from: string, to: string) =>
    Result.fromThrowable(() => {
      renameSync(from, to)
    }, fileFailed(from))()

  static readonly runTask = (task: Result<unknown, Error>) => {
    task.match(
      () => undefined,
      ({ message }) => {
        console.error(`Error: ${message}`)
        process.exitCode = 1
      },
    )
  }
}
