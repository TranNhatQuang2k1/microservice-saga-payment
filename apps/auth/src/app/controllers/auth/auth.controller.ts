import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { LoginUserData, LoginUserService, LogoutUserService, RefreshTokenService, TokenData } from '../../services/user/user.service'
import { ServiceError } from '../../services/erorrs/errors'


export function createAuthControllers(fastify: FastifyInstance) {
  const loginService = new LoginUserService({ userRepo: fastify.userRepo, jwt: fastify.jwtAuth })
  const rfService    = new RefreshTokenService({ userRepo: fastify.userRepo, jwt: fastify.jwtAuth })
  const lgService    = new LogoutUserService({ jwt: fastify.jwtAuth })

  const login = async (
    request: FastifyRequest<{ Body: LoginUserData }>,
    reply: FastifyReply,
  ) => {
    try {
      const { user, token } = await loginService.run(request.body)
      return reply.code(200).send({
        status: 'success',
        message: 'Login successful',
        data: {
          user: {
            uid:       user.uid,
            firstName: user.firstName,
            lastName:  user.lastName,
            email:     user.email,
          },
          token,
        },
      })
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(403).send({ status: 'error', message: 'Invalid credentials' })
      }
      fastify.log.error(err)
      return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
    }
  }

  const refreshToken = async (
    request: FastifyRequest<{ Body: TokenData }>,
    reply: FastifyReply,
  ) => {
    const { access_token, refresh_token } = request.body
    if (!access_token || !refresh_token) {
      return reply.code(400).send({ status: 'error', message: 'Invalid token' })
    }
    try {
      const token = await rfService.run(request.body)
      return reply.code(200).send({
        status: 'success',
        message: 'Token refresh successful',
        data: token,
      })
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(401).send({ status: 'error', message: 'Invalid or expired token' })
      }
      fastify.log.error(err)
      return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
    }
  }

  const logout = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const token = (request.headers['authorization'] ?? '').split(' ')[1]
    try {
      await lgService.run(token)
      return reply.code(200).send({ status: 'success', message: 'Logout successful' })
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(401).send({ status: 'error', message: (err as ServiceError).message })
      }
      fastify.log.error(err)
      return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
    }
  }

  return { login, refreshToken, logout }
}
