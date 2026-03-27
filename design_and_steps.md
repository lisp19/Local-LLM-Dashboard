# VLLM / Llama.cpp Dashboard - 设计与执行步骤

## 1. 架构与设计 (Design)
本项目是一个极简、轻量级的本地大模型推理服务监控看板，直接在宿主机运行。
- **技术栈**：Next.js 15 (App Router) + React 18 + Ant Design v5 + TailwindCSS + SWR。
- **运行模式**：Systemd 后台守护进程，而非 Docker 容器部署，以获取宿主机的完整 Docker 及系统访问权限。
- **后端服务 (I/O)**：
  - `lib/systemMetrics.ts`：通过 Node.js 原生 `os` 和 `child_process.execFile` 获取 CPU、内存、GPU (`nvidia-smi`) 以及容器状态 (`docker ps`, `docker stats`)。
  - 读取根目录的 `model-config.json` 获取本地配置。
- **前端页面**：
  - 顶部 Navbar 显示刷新时间。
  - 采用 Dual-Card Layout（双卡片设计）：左侧显示容器运行时资源（Runtime Card），右侧显示模型配置参数（Model Card）。
  - SWR 客户端轮询，实时刷新数据。

---

## 2. 依赖安装与项目初始化 (手动执行)

鉴于网络原因，请您在终端中**手动执行**以下依赖安装和初始化命令。

### 2.1 清理之前的残留文件 (可选)
如果您之前尝试初始化过，请先清理残留文件（注意保留您的 `kanban.md`）：
```bash
# 移动 kanban.md 到上层目录以免冲突
mv kanban.md ../
# 清除残留文件
rm -rf app components lib public next.config.mjs package*.json tsconfig.json postcss.config.mjs tailwind.config.ts .next node_modules
# 将 kanban.md 移回
mv ../kanban.md .
```

### 2.2 创建 Next.js 项目并锁定 React 18
请在 `~/kanban` 目录下运行以下命令

```bash
# 1. 再次将 kanban.md 移出以保证目录干净
mv kanban.md ../

# 2. 初始化 Next.js 项目 (选择 TypeScript, ESLint, Tailwind, App Router, 无 src 目录)
npx -y create-next-app@15 . --typescript --eslint --tailwind --app --src-dir false --import-alias "@/*" --use-npm --no-turbopack

# 3. 移回 kanban.md
mv ../kanban.md .

# 4. 强制锁定 React 为 18.x 版本
npm install react@^18.2.0 react-dom@^18.2.0 --save-exact

# 5. 安装必需的 UI 及工具依赖项 (Antd, Icons, CSSinJS, SWR)
npm install antd @ant-design/icons @ant-design/cssinjs swr tsx --legacy-peer-deps
```

> **提示**：如果网络较慢，您可以使用淘宝镜像运行 npm install：
> `npm install <packages> --registry=https://registry.npmmirror.com`

---

## 3. 后续开发步骤 (等待执行)

请您完成上述的**第 2 步 (依赖安装与项目初始化)**。完成后，请通知我，我将自动为您执行以下代码的编写：

1. **Step 1:** 创建 `model-config.json` 样例配置文件。
2. **Step 2:** 编写 `lib/systemMetrics.ts` 收集 GPU、Docker 列表、内存、CPU 等信息。
3. **Step 3:** 创建 `scripts/test-cli.ts` 并在 `package.json` 中配置 `"test:cli"` 脚本以进行脱离 Web 的独立功能测试。
4. **Step 4:** 编写 API Route `app/api/metrics/route.ts` 合并系统命令与配置文件的数据。
5. **Step 5:** 编写 `app/page.tsx` 与 `app/layout.tsx` 构建 Dual-Card Layout 的前端看板页面。
6. **Step 6:** 生成 Systemd 配置文件模板 `vllm-dashboard.service` 与部署脚本 `deploy.sh`。
