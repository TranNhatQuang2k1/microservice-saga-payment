// ── Route schemas (mirrors Convoy models) ──────────────────────────────────

const errorResponse = {
  type: 'object',
  properties: {
    status:  { type: 'string' },
    message: { type: 'string' },
  },
} as const

const tokenShape = {
  type: 'object',
  properties: {
    access_token:  { type: 'string' },
    refresh_token: { type: 'string' },
  },
} as const

export const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { type: 'string' },
      password: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        status:  { type: 'string' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                uid:       { type: 'string' },
                firstName: { type: 'string' },
                lastName:  { type: 'string' },
                email:     { type: 'string' },
                eddsa:     { type: 'boolean' },
              },
            },
            token: tokenShape,
          },
        },
      },
    },
    '4xx': errorResponse,
    '5xx': errorResponse,
  },
} as const

export const refreshSchema = {
  body: {
    type: 'object',
    required: ['access_token', 'refresh_token'],
    properties: {
      access_token:  { type: 'string' },
      refresh_token: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        status:  { type: 'string' },
        message: { type: 'string' },
        data: tokenShape,
      },
    },
    '4xx': errorResponse,
    '5xx': errorResponse,
  },
} as const

export const logoutSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        status:  { type: 'string' },
        message: { type: 'string' },
      },
    },
    '4xx': errorResponse,
    '5xx': errorResponse,
  },
} as const

export const registerSchema = {
  body: {
    type: 'object',
    required: ['firstName', 'lastName', 'email', 'password'],
    properties: {
      firstName: { type: 'string', minLength: 1 },
      lastName:  { type: 'string', minLength: 1 },
      email:     { type: 'string', format: 'email' },
      password:  { type: 'string', minLength: 6 },
    },
  },
} as const