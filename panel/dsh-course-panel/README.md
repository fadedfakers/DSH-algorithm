# dsh-course-panel

深度学习课程问题池面板 —— DSH Profile Bundle。

## 这个包是什么

原先它是一个**动态 Cordis 插件**（`cordis_define` 创建）。动态插件只活在当前 DSH 进程的内存里，
**DSH 一重启就消失**，所以无法作为长期能力交付。这个包是它的**固化形态**：一个可安装的 Profile Bundle。

## 与动态版本的关键差异

| 项 | 动态插件 | 本包（固化） |
| --- | --- | --- |
| 存活范围 | 当前进程，重启即失 | 随 Profile 常驻 |
| 装载位置 | 进程内存 | `dsh.profile.bundles` |
| 客户端↔宿主 IPC | `harness.handle` / `host.call`（进程内） | **HTTP**：`/cip-api/<action>` + `fetch` |
| 客户端格式 | 动态求值 | `window.__ModuleLoader__.load({id, factory})` bundle |

> ⚠️ `harness` **不是任何包的导出**（已核实 `@deepseek-ai/dsh-scope` 不导出它），
> 它是动态沙箱注入的全局。因此正式插件不能用 `harness.handle`——
> 原来 15 个 handler 全部改写为 `/cip-api/*` HTTP 路由，客户端用同名 `host.call` shim 转发，
> 好处是所有调用点一个字都没改。

## 提供的路由

| 路由 | 用途 |
| --- | --- |
| `/cip-api/info` | 工作区状态、章列表、默认枚举 |
| `/cip-api/tree` | 课程脉络（5 模块 / 30 课时，含教案缺失标记） |
| `/cip-api/slides` | 课件页数据（`{chapter}` 选章） |
| `/cip-api/pool` | 问题池列表；带 `{path}` 则读单条 |
| `/cip-api/docs` | 材料列表；带 `{path}` 则读单份 |
| `/cip-api/ask` | 框选提问 → AI 作答 → 归档成问题条目 |
| `/cip-api/followup` | 带上下文的多轮追问 |
| `/cip-api/aianswer` | 重答首问 |
| `/cip-api/update` | 更新状态/字段/小节 |
| `/cip-api/submission.list` | 某课时的作业提交列表 |
| `/cip-api/submission.save` | 保存学生提交的代码 |
| `/cip-api/submission.read` | 读取某份提交 |
| `/cip-api/submission.grade` | 按教案批改（不给分数，只做证据初筛） |
| `/cip-api/audit` | **教师专属**：问题审计 —— 值得共享 / 只答本人 |
| `/cip-media/<章>/<文件>` | 课件图片（每章独立目录，防同名覆盖） |
| `/cip-katex/katex.min.{js,css}` | 公式渲染（本机 node_modules，不依赖外网） |
| `/cip-panel.css` | 面板样式表（白名单搬运，便于热改） |

## 角色分离（v0.2.0）

同一个包同时服务两种人，靠环境变量区分，**默认学生**（缺省即最保守）：

| 环境变量 | 取值 | 缺省 |
| --- | --- | --- |
| `CIP_ROLE` | `teacher` / `student` | `student` |
| `CIP_COURSE_CODE` | 课程码，随 `/cip-api/info` 下发 | 空 |

`/cip-api/info` 会下发 `role` / `courseCode` / `canGrade` / `canPublish` / `canAudit`，
客户端据此裁剪界面（学生看不到「作业批改」与审计按钮）。

宿主侧对**教师专属动作**做真实拦截（`requireTeacher`），不依赖界面裁剪：
未带教师角色调用 `update` / `submission.grade` / `audit` 会被拒绝。
界面裁剪只是体验，宿主拦截才是边界。

教师端启动：

```powershell
$env:CIP_ROLE = 'teacher'; $env:CIP_COURSE_CODE = '<你的课程码>'; dsh web
```

## 安装

```sh
dsh plugin --profile web add <本包路径或 tarball>
# 然后重启该 Profile
```

## 配置

工作区路径默认取环境变量 `CIP_WORKSPACE`，未设置时用内置默认值。
换机器部署时**必须**改这里（见 `src/index.js` 顶部 `WORKSPACE`）。

角色与课程码见上文「角色分离」。`CIP_ROLE` 不设即学生端——这是刻意的：
装错了顶多少几个按钮，不会把教师权限漏给学生。

## 工作区解析（v0.3.0）

插件本来只为老师那台机器写，工作区是硬编码的。学生装到自己机器上时那个路径
不存在，面板会读到空目录，表现为「一条问题都没有、课件 0 页」，**且不报错** ——
这类失败最难查。所以解析改成三级，每级都验证目录里确实有 `课程中心/`：

| 顺序 | 来源 | 谁在用 |
| --- | --- | --- |
| 1 | 环境变量 `CIP_WORKSPACE` | 临时指定 / 排查问题 |
| 2 | `~/.dsh/cip-workspace.txt`（或 `CIP_WORKSPACE_FILE`） | **学生走这条**，由 `install.ps1` 写入 |
| 3 | 内置默认值（教师机路径） | 兼容老师原来那台机器 |

判据不是「目录存在」，而是「它像不像课程工作区」。写成 `C:\Windows` 也存在的
目录会被跳过继续回退 —— 否则你会得到一个能打开、但完全空白的面板。

`/cip-api/info` 会返回 `workspaceHow`（怎么定下来的）与 `workspaceTried`（试过哪些），
学生端面板空白时直接看这一项就知道是不是路径没对上。

## 扩展名回退（v0.3.0）

课件 JSON 里写的是抽取时的**原始**扩展名（`.png`/`.jpeg`/`.gif`），而学生端发的是
转码后的 `.webp`（体积约为原来的 30%，见 `课程发布/tools/to_webp.py`）。两边必然对不上。
媒体路由因此做一次等价名查找：原名找不到时，换成同一个 stem 的其它已知扩展名。
**只改「读哪个文件」，不改 JSON、不改客户端** —— 客户端拿到的仍是它要的那个 URL。

视频（`.mp4`）是有意不随课程包分发的：单个可达 34 MB，且本来就是 PPT 里嵌的录屏片段。
请求这类文件时返回一张 SVG 说明牌，面板上显示「此视频未随课程包分发」，
比一个破图有用。

## 自带静态资源（v0.3.0）

`lib/katex/` 与 `lib/panel.css` 随包分发，不再依赖 profile 里恰好装没装 katex。
原先 katex 是从 `~/.dsh/profiles/web/node_modules/katex` 读的 —— 那只是老师机上
`dsh-better-sidebar` 的传递依赖（经 `mermaid`），学生 profile 根本没有，
公式渲染会直接挂掉。样式表仍优先读工作区里的源文件（老师改样式时刷新即生效），
读不到才用包内副本。

## 已知限制

- **课件章节名写死在 `CHAPTERS`**（第一/二/三章）。新增章节需改代码并重装。
- **`/cip-api/*` 无鉴权**。本包假定它只绑在本机回环或受信的隧道后面。
  不要把它直接暴露到公网——面板能读写你的课程工作区。
  `requireTeacher` 防的是「同一个 DSH 进程里点错按钮」，**不是**网络安全边界。
- 状态词表用「转教案修订」（与 `课程问题池/README.md` 的权威定义一致）。

## 目录

```
course-panel-plugin/
├─ package.json          声明 dsh.bundle.patch 与 dsh.client
├─ cordis.patch.yml      装载行：- insert: [{ id: course-panel, name: dsh-course-panel }]
├─ src/index.js          宿主半区（HTTP 路由 + 业务逻辑）
└─ lib/client.js         客户端半区（ModuleLoader bundle）
```
