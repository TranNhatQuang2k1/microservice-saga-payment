// ── Route schemas (mirrors Convoy models) ──────────────────────────────────

export const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { type: 'string' },
      password: { type: 'string' },
    },
  },
} as const

export const refreshSchema = {
  body: {
    type: 'object',
    required: ['access_token', 'refresh_token'],
    properties: {
      access_token: { type: 'string' },
      refresh_token: { type: 'string' },
    },
  },
} as const

// Thêm khối này vào dưới cùng
export const registerSchema = {
  body: {
    type: 'object',
    required: ['firstName', 'lastName', 'email', 'password'],
    properties: {
      firstName: { type: 'string', minLength: 1 },
      lastName: { type: 'string', minLength: 1 },
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 6 },
    },
  },
} as const