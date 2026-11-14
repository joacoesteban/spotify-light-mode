#!/usr/bin/env bun
//MISE description="Replace the Mac's Secure Enclave key in the ci fnox profile: generate it, re-encrypt the profile to it with the previous one, move it into age-se.txt, and commit both files"
import { safeTry } from 'neverthrow'

import { Credentials } from '../credentials'

const { ROOT, log, output, exec, editProfile, move, commit, runTask } =
  Credentials

// The profile decrypts with age-se.txt until the re-encryption is done, so the
// new identity waits next to it.
const next = `${ROOT}age-se.next.txt`

runTask(
  safeTry(function* () {
    log('Generating a Secure Enclave key that unlocks with biometry.')

    yield* exec('age-plugin-se', [
      'keygen',
      '--access-control=any-biometry',
      '-o',
      next,
    ])

    const recipient = yield* output('age-plugin-se', [
      'recipients',
      '-i',
      next,
      '--recipient-type',
      'tag',
    ])

    log(`Its recipient is ${recipient}.`)

    yield* editProfile(
      /^(recipients = \[\n\s*"[^"]*",\n\s*")age1[^"]*/m,
      `$1${recipient}`,
    )

    log(
      'Re-encrypting the ci profile to it, decrypting with the previous Mac key.',
    )
    yield* exec('fnox', [
      '-P',
      'ci',
      'reencrypt',
      '--provider',
      'age',
      '--force',
    ])
    yield* move(next, `${ROOT}age-se.txt`)

    return commit(
      ['fnox.toml', 'age-se.txt'],
      "ci(credentials): replace the Mac's age key",
    )
  }),
)
