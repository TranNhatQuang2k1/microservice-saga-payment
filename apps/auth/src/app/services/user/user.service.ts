import { JwtEdDSA } from './../../helper/realm/jwt/jwt-eddsa';
 
// import * as bcrypt from 'bcrypt'
 
// eslint-disable-next-line @nx/enforce-module-boundaries
import * as bcrypt from '@node-rs/bcrypt'
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
  private readonly jwtEdDSA: JwtEdDSA

  constructor(opts: { userRepo: UserRepository; jwt: Jwt, jwtEdDSA: JwtEdDSA }) {
    this.userRepo = opts.userRepo
    this.jwt = opts.jwt
    this.jwtEdDSA = opts.jwtEdDSA
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

  async runJwtEdDSA(data: LoginUserData): Promise<{ user: User; token: Token }> {
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
    const token = this.jwtEdDSA.generateToken(user)
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

  // KHAI BÁO BỘ NHỚ LƯU TRỮ CÁC REQUEST ĐANG BAY (IN-FLIGHT)
  // Map này lưu cacheKey -> Promise đang thực thi
  private readonly flighting = new Map<string, Promise<Omit<User, 'password'>>>()
  private count = 0;
  constructor(opts: { userRepo: UserRepository; cache: Cache }) {
    this.userRepo = opts.userRepo
    this.cache = opts.cache
  }

  async run(uid: string): Promise<Omit<User, 'password'>> {
    const cacheKey = `user:profile:${uid}`

    // Cache hit → trả về luôn không đụng DB
    const cached = await this.cache.get<Omit<User, 'password'>>(cacheKey)
    if (cached) return cached

    // 2. NẾU CACHE MISS: Kiểm tra xem có ai đang đi lấy data cho ID này chưa?
    // Nếu có 99.999 request vào sau, chúng sẽ chui vào lệnh if này và đợi.
    if (this.flighting.has(cacheKey)) {
      ++this.count
      console.log(`[Dedup] 1 request đang chờ ké data từ DB cho ID: ${uid} ${this.count}`)
      return this.flighting.get(cacheKey)!
    }
    // 3. Nếu chưa có ai lấy (Request đầu tiên lọt vào đây)
    // Tạo ra một Promise đi lấy DB và nhét nó vào Map
    const fetchPromise = this.fetchFromDBAndCache(uid, cacheKey)
    this.flighting.set(cacheKey, fetchPromise)

    try {
      // Đợi Promise thực thi xong và trả về kết quả
      return await fetchPromise
    } finally {
      // QUAN TRỌNG: Lấy xong (hoặc lỗi) thì phải xóa Promise khỏi Map
      // Để các request sau này (khi cache thực sự hết hạn) còn có thể query lại
      this.flighting.delete(cacheKey)
    }
  }

  // Tách logic lấy DB ra một hàm riêng cho sạch
  private async fetchFromDBAndCache(uid: string, cacheKey: string): Promise<Omit<User, 'password'>> {
    let user: User
    try {
      user = await this.userRepo.findUserByID(uid)
    } catch (err) {
      if (err instanceof ErrUserNotFound) throw new ServiceError('user not found')
      throw new ServiceError((err as Error).message)
    }

    const { password, ...userWithoutPassword } = user

    // Lưu vào cache
    await this.cache.set(cacheKey, userWithoutPassword, USER_CACHE_TTL)
    return userWithoutPassword
  }
}
