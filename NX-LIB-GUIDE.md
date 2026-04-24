# Nx Monorepo — Hướng dẫn tạo & config Library

## Mục lục
1. [Tạo workspace Nx](#1-tạo-workspace-nx)
2. [Cài plugin @nx/node](#2-cài-plugin-nxnode)
3. [Tạo library](#3-tạo-library)
4. [Cấu trúc file bắt buộc](#4-cấu-trúc-file-bắt-buộc)
5. [Config từng file](#5-config-từng-file)
6. [Đăng ký library vào workspace](#6-đăng-ký-library-vào-workspace)
7. [Cách import tối ưu (tree-shaking)](#7-cách-import-tối-ưu-tree-shaking)
8. [Checklist khi tạo lib mới](#8-checklist-khi-tạo-lib-mới)
9. [Lỗi thường gặp](#9-lỗi-thường-gặp)

---

## 1. Tạo workspace Nx

```bash
npx create-nx-workspace@latest my-platform --preset=ts --packageManager=yarn
cd my-platform
```

Cấu trúc ban đầu:
```
my-platform/
├── apps/
├── libs/
├── tsconfig.base.json   ← paths alias cho toàn workspace
├── tsconfig.json        ← references tới tất cả apps/libs
├── package.json         ← workspaces khai báo libs
└── nx.json
```

---

## 2. Cài plugin @nx/node

```bash
yarn add -D @nx/node
```

Dùng để generate Node.js app và lib với đầy đủ build/test target.

---

## 3. Tạo library

```bash
# Dùng @nx/js:lib cho shared util lib (interfaces, configs, strategies, ...)
yarn nx g @nx/js:lib my-lib \
  --directory=libs/my-lib \
  --bundler=tsc \
  --importPath=@org/my-lib \
  --unitTestRunner=none

# Dùng @nx/node:library CHỈ KHI lib cần Node.js built-in APIs (fs, child_process, ...)
yarn nx g @nx/node:library my-lib \
  --directory=libs/my-lib \
  --importPath=@org/my-lib \
  --unitTestRunner=none
```

> **Lưu ý `--importPath`:** Nx dùng flag này để ghi vào `package.json "name"`.
> Phải đặt đúng `@org/` ngay từ đầu — nếu sai (ví dụ `@src/`) thì `yarn install` sẽ tạo symlink sai tên,
> dẫn đến `Cannot find module` dù đã khai báo đủ trong tsconfig.

**So sánh hai plugin:**

| | `@nx/js:lib` | `@nx/node:library` |
|---|---|---|
| Phù hợp cho | Shared lib thuần TS (interfaces, utils, strategies) | Lib dùng Node.js APIs (fs, http, child_process) |
| Bundler mặc định | Chọn được: `tsc`, `esbuild`, `rollup` | `tsc` |
| Targets sinh ra | `build`, `lint`, `test` | `build`, `lint`, `test` |

---

## 4. Cấu trúc file bắt buộc

Mỗi lib cần đủ 4 file này:

```
libs/my-lib/
├── src/
│   ├── index.ts          ← barrel file, export tất cả public API
│   └── lib/
│       └── my-feature.ts
├── package.json          ← khai báo tên @org/my-lib và exports map
├── tsconfig.json         ← dùng bởi IDE / language server
└── tsconfig.lib.json     ← dùng bởi tsc --build
```

---

## 5. Config từng file

### 5a. `libs/my-lib/package.json`

```json
{
  "name": "@org/my-lib",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@org/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "dependencies": {
    "tslib": "^2.3.0"
  }
}
```

**Giải thích các trường quan trọng:**

| Trường | Mục đích |
|---|---|
| `name` | Phải trùng với key trong `tsconfig.base.json paths` và `package.json workspaces` |
| `sideEffects: false` | Báo cho bundler biết lib này an toàn để tree-shake — chỉ bundle code được import |
| `exports["."]["@org/source"]` | Custom condition — khi TypeScript thấy `customConditions: ["@org/source"]` trong tsconfig, nó dùng file `.ts` gốc thay vì `.js` đã build |
| `exports["."]["import"]` | Runtime Node.js dùng file đã build |

### 5b. `libs/my-lib/tsconfig.json` (dùng bởi IDE)

```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "../../libs/other-lib-that-this-lib-imports" }
  ]
}
```

> Nếu lib này import từ lib khác trong workspace, khai báo reference ở đây để IDE hiểu.

### 5c. `libs/my-lib/tsconfig.lib.json` (dùng bởi tsc --build)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo",
    "emitDeclarationOnly": false,
    "moduleResolution": "nodenext",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../../libs/other-lib-that-this-lib-imports" }
  ]
}
```

> `references` ở đây phải trùng với `tsconfig.json` — cần khai báo ở **cả hai** vì IDE dùng file khác với `tsc`.

### 5d. `libs/my-lib/src/index.ts` (barrel file)

```typescript
// Export tất cả public API — không export thứ gì là internal
export { MyClass, myFunction } from './lib/my-feature.js';
export type { MyInterface } from './lib/my-types.js';
```

> Dùng extension `.js` trong import (dù file thực là `.ts`) vì `moduleResolution: "nodenext"` yêu cầu explicit extensions theo ESM spec.

### 5e. `tsconfig.base.json` (root workspace)

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "customConditions": ["@org/source"],
    "paths": {
      "@org/my-lib": ["libs/my-lib/src/index.ts"],
      "@org/my-lib/*": ["libs/my-lib/src/lib/*"]
    }
  }
}
```

**Phải có cả hai entry** cho mỗi lib:
- `"@org/my-lib"` → trỏ đến `src/index.ts` (root import, dùng phổ biến nhất)
- `"@org/my-lib/*"` → trỏ đến `src/lib/*` (subpath, ít dùng hơn)

---

## 6. Đăng ký library vào workspace

### 6a. `package.json` root — thêm vào `workspaces`

```json
{
  "workspaces": [
    "apps/*",
    "libs/my-lib"
  ]
}
```

### 6b. `tsconfig.json` root — thêm vào `references`

```json
{
  "references": [
    { "path": "./libs/my-lib" }
  ]
}
```

### 6c. Chạy install để tạo symlink

```bash
yarn install
```

Sau lệnh này, `node_modules/@org/my-lib` sẽ là symlink trỏ về `libs/my-lib`. Đây là bước **bắt buộc** với `moduleResolution: "nodenext"` vì TypeScript resolve package qua `node_modules`, không qua `tsconfig paths` đơn thuần.

---

## 7. Cách import tối ưu (tree-shaking)

### Import đúng cách

```typescript
// Luôn import từ root của lib
import { myFunction, MyClass } from '@org/my-lib';
```

### Tại sao không bị kéo theo cả lib?

Ba điều kiện cần đủ để tree-shaking hoạt động:

| Điều kiện | Cấu hình tương ứng |
|---|---|
| Output là ESM (không phải CommonJS) | `"module": "nodenext"` trong tsconfig — **không** dùng `"module": "commonjs"` |
| Bundler biết không có side effects | `"sideEffects": false` trong `package.json` của lib |
| Export là named export | `export { foo }` thay vì `export default { foo, bar }` |

Nếu thiếu một trong ba, bundler sẽ bundle toàn bộ lib dù chỉ import 1 hàm.

### Kiểm tra nhanh

```bash
# Build app và xem bundle size
yarn nx build my-app --analyze

# Nếu thấy code từ lib không dùng vẫn xuất hiện → kiểm tra lại 3 điều kiện trên
```

---

## 8. Checklist khi tạo lib mới

```
[ ] Tạo thư mục libs/my-lib/src/lib/ với code thực
[ ] Tạo libs/my-lib/src/index.ts — barrel export
[ ] Tạo libs/my-lib/package.json
      - name đúng format @org/my-lib
      - sideEffects: false
      - exports map có "@org/source" condition
[ ] Tạo libs/my-lib/tsconfig.json
      - references đến libs khác mà lib này import
[ ] Tạo libs/my-lib/tsconfig.lib.json
      - references trùng với tsconfig.json
[ ] Thêm vào package.json root → workspaces
[ ] Thêm vào tsconfig.json root → references
[ ] Thêm vào tsconfig.base.json → paths (cả root và wildcard)
[ ] Chạy yarn install
[ ] Restart TS Server trong VS Code (Ctrl+Shift+P → "TypeScript: Restart TS Server")
```

---

## 9. Lỗi thường gặp

### `Cannot find module '@org/my-lib'`

Kiểm tra theo thứ tự:

1. `package.json` của lib có `name: "@org/my-lib"` chưa (không phải `@src/` hay tên khác)?
2. `package.json` root có khai báo lib trong `workspaces` chưa?
3. Đã chạy `yarn install` sau khi thêm/đổi tên chưa? → `node_modules/@org/my-lib` có tồn tại không?
4. `tsconfig.base.json paths` có entry `"@org/my-lib"` (không có `/*`) chưa?
5. Đã restart TS Server chưa?

### Import resolve được nhưng build lỗi

- Kiểm tra `tsconfig.lib.json` có `references` đến lib được import không.
- `tsconfig.json` (IDE) cũng cần `references` tương tự.

### Tree-shaking không hoạt động (bundle quá lớn)

- Xem lib có `"module": "commonjs"` trong tsconfig không → xóa đi, để kế thừa `nodenext` từ root.
- Xem `package.json` lib có `"sideEffects": false` không.
- Xem các export có dùng named export không (tránh `export default`).

### `@org/source` condition không hoạt động (TypeScript dùng dist thay vì src)

- `tsconfig.base.json` phải có `"customConditions": ["@org/source"]`.
- `package.json` của lib phải có `"@org/source": "./src/index.ts"` bên trong `exports["."]`.
- Hai chuỗi này phải **giống hệt nhau**.

---

## 10. Tạo Application (Node.js / Fastify)

### Câu lệnh

```bash
# Tạo Node.js app với Fastify (bundler esbuild — nhanh hơn tsc cho app)
yarn nx g @nx/node:application my-service \
  --directory=apps/my-service \
  --bundler=esbuild \
  --framework=fastify \
  --e2eTestRunner=jest \
  --unitTestRunner=jest
```

Sau khi chạy, Nx sinh ra:
```
apps/
├── my-service/
│   ├── src/
│   │   ├── main.ts               ← entry point, khởi động Fastify server
│   │   └── app/
│   │       ├── app.ts            ← register plugins/routes
│   │       ├── plugins/
│   │       └── routes/
│   ├── package.json              ← nx targets: build, serve, test
│   ├── tsconfig.json             ← IDE config
│   └── tsconfig.app.json         ← tsc build config
└── my-service-e2e/               ← e2e test app (nếu chọn --e2eTestRunner)
    ├── src/
    └── tsconfig.json
```

### Cấu trúc `package.json` của app

App khác lib ở chỗ: targets được khai báo thẳng trong `package.json` (không có `project.json`):

```json
{
  "name": "@org/my-service",
  "version": "0.0.1",
  "private": true,
  "nx": {
    "targets": {
      "build": {
        "executor": "@nx/esbuild:esbuild",
        "defaultConfiguration": "production",
        "options": {
          "platform": "node",
          "outputPath": "apps/my-service/dist",
          "format": ["cjs"],
          "bundle": false,
          "main": "apps/my-service/src/main.ts",
          "tsConfig": "apps/my-service/tsconfig.app.json"
        },
        "configurations": {
          "development": {},
          "production": { "esbuildOptions": { "sourcemap": false } }
        }
      },
      "serve": {
        "continuous": true,
        "executor": "@nx/js:node",
        "defaultConfiguration": "development",
        "dependsOn": ["build"],
        "options": {
          "buildTarget": "@org/my-service:build",
          "runBuildTargetDependencies": false
        },
        "configurations": {
          "development": { "buildTarget": "@org/my-service:build:development" },
          "production":  { "buildTarget": "@org/my-service:build:production" }
        }
      }
    }
  },
  "dependencies": {
    "fastify": "~5.2.1"
  }
}
```

> **`bundle: false`** — esbuild không bundle thành 1 file duy nhất, giữ nguyên cấu trúc module.
> Phù hợp cho Node.js microservice vì tận dụng được `node_modules` sẵn có khi deploy.
> Nếu build CLI tool hoặc Lambda thì đổi thành `bundle: true`.

### `tsconfig.app.json` của app

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "tsBuildInfoFile": "dist/tsconfig.app.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts", "src/**/*.test.ts"],
  "references": [
    { "path": "../../libs/my-lib" }
  ]
}
```

> Nếu app import lib nào trong workspace → khai báo vào `references` ở đây (tương tự tsconfig.lib.json của lib).

### Các lệnh thường dùng

```bash
# Chạy dev (watch mode — tự restart khi code thay đổi)
yarn nx serve my-service

# Build production
yarn nx build my-service

# Chạy test
yarn nx test my-service

# Build tất cả apps bị ảnh hưởng bởi thay đổi hiện tại
yarn nx affected -t build

# Build tất cả
yarn nx run-many -t build
```

### Checklist khi tạo app mới

```
[ ] Chạy lệnh nx generate ở trên
[ ] Thêm dependencies cần thiết vào package.json của app (fastify, ioredis, ...)
[ ] Nếu app import lib workspace → thêm vào tsconfig.app.json references
[ ] Thêm app vào package.json root → workspaces (nếu chưa dùng apps/*)
[ ] Chạy yarn install
```

### So sánh `@nx/node:application` vs tạo thủ công

| | Nx generator | Thủ công |
|---|---|---|
| `tsconfig.json` + `tsconfig.app.json` | Tự sinh | Phải tự viết |
| `package.json` với nx targets | Tự sinh | Phải tự viết |
| e2e app | Tự sinh kèm | Phải tạo riêng |
| eslint config | Tự sinh | Phải tạo riêng |
| Thêm vào `tsconfig.json` root | **Không tự thêm** — phải làm thủ công | — |

> Bước duy nhất Nx generator **không tự làm**: thêm app vào `references` trong `tsconfig.json` root.
> Luôn kiểm tra sau khi generate.
