import type { User } from './user'

export enum CredentialType {
  JWT = 'JWT',
  ApiKey = 'ApiKey',
  Basic = 'Basic',
}

export interface Credential {
  type: CredentialType
  token: string
}

export interface AuthenticatedUser {
  authenticatedByRealm: string
  credential: Credential
  user: User
}
