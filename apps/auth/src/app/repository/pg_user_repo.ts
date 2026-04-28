import { PostgresDb } from '../plugins/postgres' // Đường dẫn tới file plugin của cậu
import { User, UserRepository } from '../interfaces/user'
import { ErrUserNotFound } from './user'

export class PgUserRepository implements UserRepository {
  constructor(private db: PostgresDb) {}

  // -------------------------------------------------------------------------
  // 1. Hàm tìm User theo Email (Dùng cho chức năng Login)
  // -------------------------------------------------------------------------
  async findUserByEmail(email: string): Promise<User> {
    // Dùng readQuery để chọc vào PgBouncer của Read Replica (port 6433)
    const res = await this.db.readQuery(
      `SELECT 
         uid, 
         first_name as "firstName", 
         last_name as "lastName", 
         email, 
         password 
       FROM users 
       WHERE email = $1 
       LIMIT 1`,
      [email]
    )

    // Nếu không tìm thấy user, ném lỗi ra để tầng Service bắt (catch)
    if (res.rowCount === 0) {
      throw new ErrUserNotFound()
    }

    return res.rows[0] as User
  }

  // -------------------------------------------------------------------------
  // 2. Hàm tìm User theo ID (Dùng cho việc lấy Profile hoặc xác thực Token)
  // -------------------------------------------------------------------------
  async findUserByID(id: string): Promise<User> {
    const res = await this.db.readQuery(
      `SELECT 
         uid, 
         first_name as "firstName", 
         last_name as "lastName", 
         email, 
         password 
       FROM users 
       WHERE uid = $1 
       LIMIT 1`,
      [id]
    )

    if (res.rowCount === 0) {
      throw new ErrUserNotFound()
    }

    return res.rows[0] as User
  }

  async createUser(data: Omit<User, 'uid'>): Promise<User> {
    const res = await this.db.query(
      `INSERT INTO users (first_name, last_name, email, password) 
       VALUES ($1, $2, $3, $4) 
       RETURNING uid, first_name as "firstName", last_name as "lastName", email, password`,
      [data.firstName, data.lastName, data.email, data.password]
    )
    return res.rows[0] as User
  }
}