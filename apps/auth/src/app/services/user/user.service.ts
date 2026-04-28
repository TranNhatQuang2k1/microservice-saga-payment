// eslint-disable-next-line @nx/enforce-module-boundaries
import * as bcrypt from 'bcrypt'
import { User, UserRepository } from '../../interfaces/user'
import { Jwt, JwtExpiredError, Token } from '../../helper/realm/jwt/jwt'
import { ErrUserNotFound } from '../../repository/user'
import { ServiceError } from '../erorrs/errors'
import type { Cache } from '@org/caches'

const USER_CACHE_TTL = 300 // 5 phút

export type CreateUserData = Omit<User, 'uid'>

export interface LoginUserData {
  username: string // email
  password: string
}

export interface TokenData {
  access_token: string
  refresh_token: string
}

export class CreateUserService {
  private readonly userRepo: UserRepository

  constructor(opts: { userRepo: UserRepository }) {
    this.userRepo = opts.userRepo
  }

  async run(data: CreateUserData): Promise<Omit<User, 'password'>> {
    const hashedPassword = await bcrypt.hash(data.password, 10)

    try {
      const newUser = await this.userRepo.createUser({
        ...data,
        password: hashedPassword,
      })

      const { password, ...userWithoutPassword } = newUser
      return userWithoutPassword
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ServiceError('Email already exists')
      }
      throw new ServiceError(err.message)
    }
  }
}

export class LoginUserService {
  private readonly userRepo: UserRepository
  private readonly jwt: Jwt

  constructor(opts: { userRepo: UserRepository; jwt: Jwt }) {
    this.userRepo = opts.userRepo
    this.jwt = opts.jwt
  }

  async run(data: LoginUserData): Promise<{ user: User; token: Token }> {
    let user: User
    try {
      user = await this.userRepo.findUserByEmail(data.username)
    } catch (err) {
      if (err instanceof ErrUserNotFound) {
        throw new ServiceError('invalid username or password')
      }
      throw new ServiceError((err as Error).message)
    }

    const match = await bcrypt.compare(data.password, user.password)
    if (!match) {
      throw new ServiceError('invalid username or password')
    }

    const token = this.jwt.generateToken(user)
    return { user, token }
  }
}

export class LogoutUserService {
  private readonly jwt: Jwt

  constructor(opts: { jwt: Jwt }) {
    this.jwt = opts.jwt
  }

  async run(token: string): Promise<void> {
    let verified
    try {
      verified = await this.jwt.validateAccessToken(token)
    } catch (err) {
      throw new ServiceError('failed to validate token: ' + (err as Error).message)
    }

    try {
      await this.jwt.blacklistToken(verified, token)
    } catch (err) {
      throw new ServiceError('failed to blacklist token: ' + (err as Error).message)
    }
  }
}

export class RefreshTokenService {
  private readonly userRepo: UserRepository
  private readonly jwt: Jwt

  constructor(opts: { userRepo: UserRepository; jwt: Jwt }) {
    this.userRepo = opts.userRepo
    this.jwt = opts.jwt
  }

  async run(data: TokenData): Promise<Token> {
    try {
      await this.jwt.validateAccessToken(data.access_token)
    } catch (err) {
      if (err instanceof JwtExpiredError) {
        const expiry = new Date(err.verifiedToken.expiry * 1000)
        const gracePeriod = new Date(expiry.getTime() + 5 * 60 * 1000)
        if (new Date() > gracePeriod) {
          throw new ServiceError((err as Error).message)
        }
      } else {
        throw new ServiceError((err as Error).message)
      }
    }

    let verified
    try {
      verified = await this.jwt.validateRefreshToken(data.refresh_token)
    } catch (err) {
      throw new ServiceError((err as Error).message)
    }

    let user
    try {
      user = await this.userRepo.findUserByID(verified.userID)
    } catch (err) {
      if (err instanceof ErrUserNotFound) throw new ServiceError((err as Error).message)
      throw new ServiceError('failed to find user by id')
    }

    const token = this.jwt.generateToken(user)

    try {
      await this.jwt.blacklistToken(verified, data.refresh_token)
    } catch {
      throw new ServiceError('failed to blacklist token')
    }

    return token
  }
}

export class GetUserService {
  private readonly userRepo: UserRepository
  private readonly cache: Cache

  constructor(opts: { userRepo: UserRepository; cache: Cache }) {
    this.userRepo = opts.userRepo
    this.cache = opts.cache
  }

  async run(uid: string): Promise<Omit<User, 'password'>> {
    const cacheKey = `user:profile:${uid}`

    // Cache hit → trả về luôn không đụng DB
    const cached = await this.cache.get<Omit<User, 'password'>>(cacheKey)
    if (cached) return cached

    // Cache miss → query DB
    let user: User
    try {
      user = await this.userRepo.findUserByID(uid)
    } catch (err) {
      if (err instanceof ErrUserNotFound) throw new ServiceError('user not found')
      throw new ServiceError((err as Error).message)
    }

    const { password, ...userWithoutPassword } = user

    // Lưu vào cache RAM TTL 5 phút
    await this.cache.set(cacheKey, userWithoutPassword, USER_CACHE_TTL)

    return userWithoutPassword
  }
}
