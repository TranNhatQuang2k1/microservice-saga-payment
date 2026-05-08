// file: path/to/bcrypt-pool.service.ts
// eslint-disable-next-line @nx/enforce-module-boundaries
import Piscina from 'piscina'
import * as path from 'path'
import * as os from 'os'

export class BcryptPoolService {
  private readonly pool: Piscina

  constructor() {
    const cpuCores = os.cpus().length
    // Dành ~70% CPU cho việc hash, giữ lại 30% cho Main Thread và I/O
    const optimalWorkers = Math.max(2, Math.floor(cpuCores * 0.7))

    this.pool = new Piscina({
      // LƯU Ý QUAN TRỌNG: 
      // Khi build ra production (dist), file đuôi sẽ là .js. 
      // Tùy cấu hình build (Nx/NestJS) bạn cần trỏ đường dẫn cho đúng.
      filename: path.resolve(__dirname, 'bcrypt.worker.js'),
      minThreads: Math.max(2, Math.floor(optimalWorkers / 2)),
      maxThreads: optimalWorkers,
    })
  }

  async hash(plain: string, rounds = 10): Promise<string> {
    // Đẩy tác vụ sang worker tên là 'hashWorker'
    return this.pool.run({ plain, rounds }, { name: 'hashWorker' })
  }

  async compare(plain: string, hash: string): Promise<boolean> {
    // Đẩy tác vụ sang worker tên là 'compareWorker'
    return this.pool.run({ plain, hash }, { name: 'compareWorker' })
  }
}