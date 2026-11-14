#!/usr/bin/env bun
//MISE description="Replace the publish workflow's age key: re-encrypt the ci fnox profile to a new key, store its identity as the FNOX_AGE_KEY repository secret, and commit fnox.toml"
import { err, ok, safeTry } from 'neverthrow'
import { P, match } from 'ts-pattern'

import { Credentials, MissingValue } from '../credentials'

const { REPOSITORY, log, output, exec, editProfile, commit, runTask } =
  Credentials

runTask(
  safeTry(function* () {
    log('Generating a new age key for the publish workflow.')

    const identity = yield* output('age-keygen', [])
    const recipient = yield* output('age-keygen', ['-y'], { input: identity })

    const secretKey = yield* match(
      identity.split('\n').find((line) => line.startsWith('AGE-SECRET-KEY-')),
    )
      .with(P.string, (key) => ok(key))
      .otherwise(() => err(new MissingValue('AGE-SECRET-KEY')))

    log(`Its recipient is ${recipient}.`)
    yield* editProfile(/^(recipients = \[\n\s*")age1[^"]*/m, `$1${recipient}`)

    log("Re-encrypting the ci profile to it, decrypting with the Mac's key.")
    yield* exec('fnox', [
      '-P',
      'ci',
      'reencrypt',
      '--provider',
      'age',
      '--force',
    ])

    log('Replacing the FNOX_AGE_KEY repository secret.')
    yield* exec('gh', ['secret', 'set', 'FNOX_AGE_KEY', '-R', REPOSITORY], {
      input: secretKey,
    })

    log(
      'Land the commit on main before the next release, which now decrypts with the new key.',
    )

    return commit(
      ['fnox.toml'],
      "ci(credentials): replace the workflow's age key",
    )
  }),
)
