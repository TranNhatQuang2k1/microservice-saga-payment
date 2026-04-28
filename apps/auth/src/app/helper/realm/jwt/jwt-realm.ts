import { Jwt, JwtInvalidError } from './jwt'
import type { Credential, AuthenticatedUser } from '../../../interfaces/auth'
import { CredentialType } from '../../../interfaces/auth'
import type { UserRepository } from '../../../interfaces/user'
import { ErrUserNotFound } from '../../../repository/user'
import { JWT_REALM_NAME } from '../../../constant/jwt'

export class JwtRealm {
  private readonly userRepo: UserRepository
  private readonly jwt: Jwt

  constructor(userRepo: UserRepository, jwt: Jwt) {
    this.userRepo = userRepo
    this.jwt = jwt
  }

  getName(): string {
    return JWT_REALM_NAME
  }

  async authenticate(cred: Credential): Promise<AuthenticatedUser> {
    if (cred.type !== CredentialType.JWT) {
      throw new Error(
        `${this.getName()} only authenticates credential type ${CredentialType.JWT}`
      )
    }

    const verified = await this.jwt.validateAccessToken(cred.token)

    let user
    try {
      user = await this.userRepo.findUserByID(verified.userID)
    } catch (err) {
      if (err instanceof ErrUserNotFound) throw new JwtInvalidError()
      throw err
    }

    return {
      authenticatedByRealm: this.getName(),
      credential: cred,
      user,
    }
  }
}
