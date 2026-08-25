# LangGraph RAG Agent 本地启动指南（Windows）

> 面向 Java 转 Python 的开发者，从零跑通这个 Agentic RAG 项目。
> 代码目录：`E:\agent\LangGraph-RAG-Agent`

---

## 0. 这个项目由三部分组成

| 部分 | 技术 | 端口 | 作用 |
|------|------|------|------|
| 数据库 | PostgreSQL + pgvector | 5432 | 存对话记忆(checkpointer) + 文档向量 |
| 后端 | FastAPI + LangGraph | 8000 | ReAct agent、文档检索、流式响应、JWT 认证 |
| 前端 | Streamlit | 8501 | 聊天界面、文档上传、会话管理 |

启动顺序：**数据库 → 后端 → 前端**。

---

## 1. 前置准备

### 1.1 数据库：二选一（Docker 或 本地安装）

项目数据库依赖 pgvector（Postgres 的向量扩展）。有两种方式跑这个数据库，**任选一种**即可，项目代码不需要任何改动：

| | 方案 A：Docker | 方案 B：本地安装 PostgreSQL |
|---|---|---|
| 需要装什么 | Docker Desktop（约 1-2GB） | PostgreSQL 17 安装包（约 300MB）+ pgvector 预编译包（166KB） |
| pgvector 扩展 | 镜像自带，零配置 | 下载预编译 DLL 复制到安装目录，无需 Visual Studio 编译 |
| C 盘占用 | 较大（WSL2 虚拟磁盘） | 可装到 E/D 盘 |
| 适合谁 | 已有 Docker / 想学容器化 | 不想装 Docker / C 盘紧张 |
| 日常启停 | `docker start/stop` | Windows 服务自动管理 |

> 两个方案效果完全一样。选好后看第 3 节对应的步骤即可。如果拿不定主意，**方案 B（本地安装）对你更合适**——你 C 盘紧张，且本地装的 PostgreSQL 以后做其他项目也能复用。

### 1.2 Python 3.12+

你本机已有 Python 3.13.12，可用。检查：
```bash
python --version
```

### 1.3 两个 API Key

**① 通义千问 DashScope API Key（必填，对话 + 嵌入都用它）**

为什么选通义：代码里对话模型和嵌入模型共用同一个 API Key（见 `backend/app/config.py` 和 `db/pgvector_utils.py`），所以必须选一个同时提供两者的 OpenAI 兼容端点。通义千问满足，且国内直连、有免费额度。DeepSeek 不行（没有嵌入模型）。

- 打开 https://bailian.console.aliyun.com/
- 开通百炼服务 → 左侧菜单 "API-KEY" → 创建 → 复制

**② Tavily API Key（可选，联网搜索工具）**

agent 有一个 `TavilySearchResults` 工具用于联网搜索。不填会启动失败（实例化时需要非空值），但填占位值也能启动，只是联网搜索功能不可用、不影响文档问答。

- 注册 https://tavily.com → 免费额度 1000 次/月 → 复制 API Key

---

## 2. 配置 .env

项目根目录已生成 `.env`（已预填通义千问配置），你只需替换两个值：

文件位置：`E:\agent\LangGraph-RAG-Agent\.env`

需要你填的：
```
OPENAI_API_KEY=sk-在此替换为你的DashScope_API_Key
TAVILY_API_KEY=tvly-在此替换为你的Tavily密钥
```

其余保持默认即可。配置项含义：

| 变量 | 含义 |
|------|------|
| `MODEL_PROVIDER=openai` | 用 OpenAI 兼容协议调通义 |
| `MODEL_NAMES=["qwen-plus"]` | 对话模型；想省钱可换 `qwen-turbo` |
| `MODEL_BASE_URL` | 通义 OpenAI 兼容端点 |
| `EMBEDDINGS_MODEL_NAME=text-embedding-v3` | 通义嵌入模型 |
| `POSTGRES_*` | 数据库连接（对应下面容器的账号密码） |

---

## 3. 启动数据库

根据你在 1.1 节选的方案，执行对应步骤。

---

### 方案 A：Docker（pgvector 容器）

在 Git Bash 里执行：
```bash
docker run --name langgraph_postgres -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=test -e POSTGRES_DB=langgraph_db \
  -d pgvector/pgvector:pg16
```

首次会拉取镜像，等一两分钟。启动后初始化向量扩展（只需一次）：
```bash
docker exec -it langgraph_postgres psql -U postgres -d langgraph_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

检查是否就绪：
```bash
docker logs langgraph_postgres
```
看到 `database system is ready to accept connections` 即成功。

> 以后再启动不用重新 run，用 `docker start langgraph_postgres` 即可。

`.env` 数据库配置保持默认即可（密码 `test`）。

---

### 方案 B：本地安装 PostgreSQL + 预编译 pgvector（不用 Docker）

> 推荐装 **PostgreSQL 17**（生态成熟，pgvector 0.8.6 已验证；Supabase/Neon/RDS 等主流云默认就是这个版本）。如果你倾向用 16，方法完全一样，只是下载链接和 pgvector 包版本号变一下。

**第 1 步：安装 PostgreSQL 17**

1. 下载 PostgreSQL 17 Windows 安装包（EnterpriseDB 版）：
   - 打开 https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
   - 选择 **PostgreSQL 17.10** 的 Windows x86-64 版本
2. 运行安装程序，关键设置：
   - **安装目录**：你 C 盘紧张，建议改成 `E:\PostgreSQL\17`（或 D 盘）
   - **数据目录**：随之改成 `E:\PostgreSQL\17\data`
   - **超级用户密码**：自己设一个，比如 `test`（记住了，后面 `.env` 要填一样的）
   - **端口**：保持默认 `5432`
   - **区域设置**：Default locale 即可
3. 安装完成时取消勾选 "Stack Builder"（不需要）
4. 安装程序会自动注册 Windows 服务 `postgresql-x64-17`，开机自启

**第 2 步：安装 pgvector 扩展（下载预编译包，不用编译）**

1. 下载 pgvector v0.8.6 预编译包（PostgreSQL 17 版本，仅 166KB）：
   - https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/0.8.6_17/vector.v0.8.6-pg17.zip
2. 解压 ZIP，里面有以下文件：
   ```
   bin/vector.dll
   lib/vector.dll
   share/extension/vector.control
   share/extension/vector--0.8.6.sql
   share/extension/vector--0.8.0--0.8.6.sql
   ...（其他版本升级脚本）
   ```
3. 把解压出来的文件**覆盖复制**到 PostgreSQL 安装目录（如果装在 E 盘就是 `E:\PostgreSQL\17`）：
   - `lib\vector.dll` → `E:\PostgreSQL\17\lib\vector.dll`
   - `share\extension\*` → `E:\PostgreSQL\17\share\extension\`
   - `bin\vector.dll` → `E:\PostgreSQL\17\bin\vector.dll`（如果有的话）
   > 最关键的是 `lib\vector.dll` 和 `share\extension\` 下的文件，这两个必须到位。
4. 重启 PostgreSQL 服务使扩展生效：
   - 按 `Win + R`，输入 `services.msc`
   - 找到 `postgresql-x64-17`，右键 → 重新启动

**第 3 步：创建数据库 + 启用向量扩展**

打开 Git Bash（或用 pgAdmin / DataGrip 连接）：
```bash
# 用你安装时设的密码（这里假设是 test）
# 创建项目数据库
"E:/PostgreSQL/17/bin/psql.exe" -U postgres -c "CREATE DATABASE langgraph_db;"

# 在该数据库里启用 pgvector 扩展（只需一次）
"E:/PostgreSQL/17/bin/psql.exe" -U postgres -d langgraph_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

> 如果路径有空格用双引号包裹。如果设了不同密码，把 `.env` 里的 `POSTGRES_PASSWORD` 改成你的密码。

验证扩展安装成功：
```bash
"E:/PostgreSQL/17/bin/psql.exe" -U postgres -d langgraph_db -c "SELECT extname FROM pg_extension WHERE extname='vector';"
```
看到一行 `vector` 输出即成功。

**第 4 步：确认 .env 配置**

`.env` 里的数据库配置应该和你的安装一致：
```
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=test          ← 改成你安装时设的密码
POSTGRES_DATABASE=langgraph_db
```

> 本地安装的 PostgreSQL 会作为 Windows 服务自动启动，开机即可用，不需要手动启动。

---

## 4. 启动后端（FastAPI）

```bash
cd /e/agent/LangGraph-RAG-Agent/backend
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
```

> pip 安装较慢可换国内源：`pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`

安装完成后启动：
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --reload-dir ./app
```

检查：浏览器打开 http://localhost:8000/api/v1/docs ，能看到 Swagger UI 即成功。

---

## 5. 启动前端（Streamlit）

新开一个 Git Bash 窗口：
```bash
cd /e/agent/LangGraph-RAG-Agent/frontend
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
streamlit run gui/main.py
```

检查：浏览器自动打开 http://localhost:8501 ，能看到聊天界面即成功。

---

## 6. 使用流程（在浏览器里操作）

1. 打开 http://localhost:8501
2. **注册账号**（邮箱 + 密码）
3. **登录**
4. **新建一个会话**（Thread）—— 对话记忆是按 thread 隔离的
5. 在该 Thread 下**上传文档**（支持 PDF / DOCX / TXT），等待提示"索引完成"（后端会切块 + 向量化存入 pgvector）
6. **开始提问**，agent 会自动调用 `retrieve_user_documents` 工具，从你上传的文档里检索相关片段再回答

---

## 7. 这一步你要学什么（对应秋招项目"阶段二"）

跑通后，重点读这几份代码，理解工程骨架：

| 文件 | 看什么 |
|------|--------|
| `backend/app/chat/langgraph_agent.py` | `create_react_agent` 怎么把模型 + 工具 + checkpointer 编排成一个图 |
| `backend/app/chat/tools.py` | `@tool` 装饰器怎么定义检索工具，怎么用 `RunnableConfig` 拿 user_id/thread_id 做隔离 |
| `backend/app/db/pgvector_utils.py` | `PGVector` 向量库怎么初始化、文档怎么切块索引、怎么按 thread_id 过滤检索 |
| `backend/app/db/checkpointer.py` | LangGraph Postgres Checkpointer 怎么持久化对话记忆 |
| `backend/app/chat/routes.py` | 流式响应怎么把 `llm_chunk` / `tool_call` / `tool_result` 事件推给前端 |

这些就是你朋友项目里"工作流编排 + 可追溯性"的工程基础。后续你要把单 agent 改造成 Fan-out/Fan-in 四分支并行审查，就是在理解这个骨架之上动手。

---

## 8. 常见问题

**Q: Docker 方案报 `docker: command not found`**
Docker Desktop 没启动，或没装。先装好并启动 Docker Desktop，等右下角图标变绿。如果你选的是方案 B（本地安装），忽略此条。

**Q: 后端启动报 `tavily_api_key` 相关错误**
`.env` 里 `TAVILY_API_KEY` 不能为空，填占位值 `tvly-placeholder` 即可启动（联网搜索不可用，不影响文档问答）。

**Q: 后端启动报数据库连接失败**
- Docker 方案：确认容器在跑 `docker ps`，看到 `langgraph_postgres` 状态为 `Up`
- 本地方案：确认 Windows 服务 `postgresql-x64-16` 正在运行（`services.msc` 检查）
- 通用：确认 `.env` 里 `POSTGRES_HOST=127.0.0.1`、`POSTGRES_PASSWORD` 和安装时设的一致、端口 5432 没被占用

**Q: 本地方案报 `ERROR: extension "vector" does not exist`**
pgvector 扩展文件没放对位置。确认 `lib\vector.dll` 和 `share\extension\vector.control` 在 PostgreSQL 安装目录下，然后重启 `postgresql-x64-16` 服务再试。

**Q: pip install 报错（Python 3.13 兼容）**
项目原定 Python 3.12。3.13 上 `psycopg-binary` / `asyncpg` 个别版本可能无预编译包。如遇编译错误，可装 Python 3.12 后用它建 venv，或升级对应包到最新版。

**Q: 端口被占用**
- 5432 被占用：本机已有 Postgres，换个端口（改 `docker run -p 5433:5432` 并同步改 `.env` 的 `POSTGRES_PORT=5433`）
- 8000 / 8501 被占用：改 `uvicorn --port 8001` / `streamlit run --server.port 8502`

**Q: 通义千问返回鉴权失败**
检查 `OPENAI_API_KEY` 是否填对（DashScope 的 sk- 开头 Key），`MODEL_BASE_URL` 是否正确。

---

## 9. 日常启停速查

每次重新启动：

```bash
# 1. 启动数据库
#    Docker 方案：
docker start langgraph_postgres
#    本地方案：PostgreSQL 作为 Windows 服务自动启动，通常无需手动操作
#    如需手动：services.msc → postgresql-x64-16 → 启动

# 2. 启动后端（终端1）
cd /e/agent/LangGraph-RAG-Agent/backend
source .venv/Scripts/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --reload-dir ./app

# 3. 启动前端（终端2）
cd /e/agent/LangGraph-RAG-Agent/frontend
source .venv/Scripts/activate
streamlit run gui/main.py
```

停止：后端/前端 `Ctrl+C`；Docker 数据库 `docker stop langgraph_postgres`；本地数据库在 `services.msc` 里停止服务。
