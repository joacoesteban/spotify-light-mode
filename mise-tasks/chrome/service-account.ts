#!/usr/bin/env bun
//MISE description="Store a Chrome Web Store service account's client email and private key in the ci fnox profile, from the JSON key file Google Cloud downloads, and commit fnox.toml"
//USAGE arg "<file>" help="The service account's JSON key file"
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Result } from 'neverthrow'
import { z } from 'zod'

import { Credentials, FileFailed } from '../credentials'

const { store, runTask } = Credentials

const ServiceAccount = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
})

const path = resolve(
  process.env['MISE_ORIGINAL_CWD'] ?? '.',
  process.env['usage_file'] ?? '',
)

// The parse error is not printed, since the file holds the private key.
runTask(
  Result.fromThrowable(
    () => ServiceAccount.parse(JSON.parse(readFileSync(path, 'utf8'))),
    () => new FileFailed(path, 'is not a service account JSON key file'),
  )().andThen(({ client_email, private_key }) =>
    store([
      ['CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL', client_email],
      ['CHROME_SERVICE_ACCOUNT_PRIVATE_KEY', private_key],
    ]),
  ),
)
