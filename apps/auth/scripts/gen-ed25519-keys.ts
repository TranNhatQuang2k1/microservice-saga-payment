// gen-ed25519-keys.ts — One-time key generation script for EdDSA JWT.
//
// Run:
//   pnpm ts-node apps/auth/scripts/gen-ed25519-keys.ts
//
// Output:
//   • 2 key pairs (access + refresh) printed to stdout as PEM strings
//   • .env snippet ready to paste into your secrets manager / .env.local
//
// SECURITY:
//   • Private keys (.pem) are written locally for reference only — gitignore them.
//   • In production: store private keys in AWS Secrets Manager / Vault / K8s Secret.
//     The public keys can live in a regular env var or config file.
//   • Never commit private keys to version control.

import { generateKeyPairSync } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface KeyPair {
  privateKey: string
  publicKey: string
}

function generateEd25519Pair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  })
  return { privateKey, publicKey }
}

// Inline a PEM into a single-line env var value — newlines → \n literal
function pemToEnvValue(pem: string): string {
  return pem.replace(/\n/g, '\\n')
}

const outputDir = join(__dirname, '../keys')
mkdirSync(outputDir, { recursive: true })

const access  = generateEd25519Pair()
const refresh = generateEd25519Pair()

// Write PEM files (for local reference — add to .gitignore)
writeFileSync(join(outputDir, 'access-private.pem'),  access.privateKey,  { encoding: 'utf8' })
writeFileSync(join(outputDir, 'access-public.pem'),   access.publicKey,   { encoding: 'utf8' })
writeFileSync(join(outputDir, 'refresh-private.pem'), refresh.privateKey, { encoding: 'utf8' })
writeFileSync(join(outputDir, 'refresh-public.pem'),  refresh.publicKey,  { encoding: 'utf8' })

// ── Output ────────────────────────────────────────────────────────────────────

console.log('\n======== ACCESS TOKEN KEY PAIR ========')
console.log('\n[PRIVATE — Auth service only]\n')
console.log(access.privateKey)
console.log('\n[PUBLIC — safe for Order/Payment services]\n')
console.log(access.publicKey)

console.log('\n======== REFRESH TOKEN KEY PAIR ========')
console.log('\n[PRIVATE — Auth service only]\n')
console.log(refresh.privateKey)
console.log('\n[PUBLIC — safe for Order/Payment services]\n')
console.log(refresh.publicKey)

console.log('\n======== .env SNIPPET ========\n')
console.log(`# Auth service — keep private keys in secrets manager, NEVER commit`)
console.log(`JWT_PRIVATE_KEY="${pemToEnvValue(access.privateKey)}"`)
console.log(`JWT_PUBLIC_KEY="${pemToEnvValue(access.publicKey)}"`)
console.log(`JWT_REFRESH_PRIVATE_KEY="${pemToEnvValue(refresh.privateKey)}"`)
console.log(`JWT_REFRESH_PUBLIC_KEY="${pemToEnvValue(refresh.publicKey)}"`)
console.log(`JWT_ISSUER="https://auth.convoy.internal"`)
console.log(`JWT_AUDIENCE="https://api.convoy.internal"`)
console.log(`JWT_KEY_ID="2025-v1"`)
console.log(``)
console.log(`# Other microservices (Order, Payment) — public keys only`)
console.log(`AUTH_JWT_PUBLIC_KEY="${pemToEnvValue(access.publicKey)}"`)
console.log(`AUTH_JWT_ISSUER="https://auth.convoy.internal"`)
console.log(`AUTH_JWT_AUDIENCE="https://api.convoy.internal"`)

console.log('\n======== VERIFIER (Order/Payment service snippet) ========\n')
console.log(`import { createVerifier } from 'fast-jwt'`)
console.log(``)
console.log(`// Only needs public key — cannot forge tokens even if compromised`)
console.log(`const verify = createVerifier({`)
console.log(`  key:        process.env.AUTH_JWT_PUBLIC_KEY,`)
console.log(`  algorithms: ['EdDSA'],`)
console.log(`  cache:      1000,`)
console.log(`  cacheTTL:   1800_000,`)
console.log(`  allowedIss: process.env.AUTH_JWT_ISSUER,`)
console.log(`  allowedAud: process.env.AUTH_JWT_AUDIENCE,`)
console.log(`})`)
console.log(``)
console.log(`// Verify a token — sync + LRU cache (~0.005ms cached)`)
console.log(`const payload = verify(token) // throws on invalid/expired`)

console.log(`\nKeys written to: ${outputDir}`)
console.log('Add apps/auth/keys/ to .gitignore!\n')
