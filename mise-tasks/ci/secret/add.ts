#!/usr/bin/env bun
//MISE description="Encrypt secrets into the ci fnox profile the publish workflow reads, one value per key from stdin lines when piped or hidden prompts, and commit fnox.toml once"
//MISE raw=true
//USAGE arg "<key>" var=#true help="Secret key names (e.g. FIREFOX_JWT_ISSUER)"
import { Credentials } from '../../credentials'

const { read, store, runTask } = Credentials
const keys = (process.env['usage_key'] ?? '').split(' ')

runTask(
  read(keys).andThen((values) =>
    store(keys.map((key, index) => [key, values[index] ?? ''] as const)),
  ),
)
