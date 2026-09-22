/**
 * dsh-course-core —— 学生端与教师端两个插件共享的宿主内核
 *
 * 为什么要有这个包：
 *   学生端和教师端必须是**两个可独立安装的插件**（各自的侧栏入口、各自的
 *   /cip-stu、/cip-tea 路由前缀）。但两边要做的事有大量重叠：解析课程结构索引、
 *   读课件、读教案、调模型、读写问题条目、按教案批改。
 *   如果各自复制一份，任何一处修 bug 都要改两遍，而且必然漂移 —— 这个项目里
 *   已经吃过一次亏（客户端和宿主对 m.file 的理解不一致，导致所有图片都加载不出来）。
 *
 * ⚠️ 路由前缀为什么必须是两个（这是 DSH 的硬约束，不是设计偏好）：
 *   webServer.register 对重复的 (kind, path) 会**直接抛错** ——
 *   路由模式属于「组合级契约」，撞车就是配置错误。
 *   所以两个插件各带自己的前缀，也正因为前缀不同，它们**可以装在同一个
 *   DSH 进程里同时运行**，这正是老师想在一台机器上对测两端的前提。
 *
 * 公共数据面（设计原则.md 第 2/3 条）：
 *   两个插件通过**同一个课程工作区目录**交换数据。工作区可以是：
 *     · 老师机：私有工作区（含全部模块、全部学生数据）
 *     · 学生机：clone 下来的公开仓（只含已发布内容）
 *   目录分工（每个位置只有一个写入方，因此不会互相覆盖）：
 *     课程问题池/公共/            老师写（策展后），学生读
 *     课程问题池/学生/<学号>/      该学生自己写，老师读
 *     作业提交/<学号>/            该学生自己写，老师读
 *     课程中心/                   课程数据（公开仓分发）
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── 工作区解析 ────────────────────────────────────────────────
const DEFAULT_WORKSPACE = 'C:\\Users\\Administrator\\Desktop\\暑期课程'

export function readWorkspaceFile(p) {
  try {
    const t = fs.readFileSync(p, 'utf8').trim()
    if (!t) return null
    const first = t.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').trim())
      .find((l) => l && l[0] !== '#' && l[0] !== ';')
    return first || null
  } catch (e) { return null }
}

/** 三级解析：环境变量 → 配置文件 → 内置默认值。每级都验证「像不像课程工作区」。 */
export function resolveWorkspace() {
  const tried = []
  const candidates = []
  if (process.env.CIP_WORKSPACE) candidates.push(['环境变量 CIP_WORKSPACE', process.env.CIP_WORKSPACE])
  const wf = process.env.CIP_WORKSPACE_FILE || path.join(os.homedir(), '.dsh', 'cip-workspace.txt')
  const fromFile = readWorkspaceFile(wf)
  if (fromFile) candidates.push(['配置文件 ' + wf, fromFile])
  candidates.push(['内置默认值（教师机）', DEFAULT_WORKSPACE])

  for (const [how, dir] of candidates) {
    const abs = path.resolve(dir)
    const looksRight = fs.existsSync(path.join(abs, '课程中心'))
    tried.push(how + ' → ' + abs + (looksRight ? ' ✓' : ' ✗'))
    if (looksRight) return { dir: abs, how, tried }
  }
  return { dir: path.resolve(candidates[0][1]), how: candidates[0][0] + '（未验证）', tried }
}

// ── 常量 ──────────────────────────────────────────────────────
export const CHAPTERS = ['第一章', '第二章', '第三章']
export const MODULES = ['模块一', '模块二', '模块三', '模块四', '模块五']
export const TYPES = ['概念问题', '代码报错', '环境问题', '数值稳定性', '作业疑问', '讲义问题', '内容建议']
export const SEVERITIES = ['阻塞', '高', '中', '低']
export const STATUSES = ['待处理', '已答复', '待复盘', '已沉淀', '转教案修订']
export const SOURCES = ['课堂', '作业', 'B站评论', '私聊', '答疑课', '自测', '阅读器框选图区', '阅读器拖选文字']

export const SLIDES_DIR = '课程中心\\预览数据'
export const MEDIA_DIR_REL = '课程中心\\预览数据\\media'
export const INDEX_REL = '课程中心\\课程结构索引.json'

/** 公共数据面（见文件头注释） */
export const PUBLIC_ITEMS_REL = '课程问题池\\公共'
export const STUDENT_ITEMS_REL = '课程问题池\\学生'
export const SUBMIT_ROOT_REL = '作业提交'

export const SECTION_ORDER = ['原始提问', '现象', '初步判断', 'AI 答复', '处理结论', '复盘', '问题总结', '教师归档']
export const THREAD_TITLE = '追问记录'
export const MAX_THREAD_TURNS = Number(process.env.CIP_MAX_TURNS) > 0 ? Number(process.env.CIP_MAX_TURNS) : 40

export const MAX_SUB_BYTES = Number(process.env.CIP_MAX_SUB_BYTES) > 0 ? Number(process.env.CIP_MAX_SUB_BYTES) : 4 * 1024 * 1024
export const ALLOWED_EXT = (process.env.CIP_ALLOWED_EXT || '.py,.ipynb,.md,.txt,.yaml,.yml,.json,.csv,.tsv')
const VIDEO_EXT = /\.(mp4|mov|webm|avi|m4v)$/i
const RASTER_EXT = ['.webp', '.png', '.jpg', '.jpeg', '.gif']

// ── 纯工具 ────────────────────────────────────────────────────
export const oneLine = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
export const pad4 = (v) => { const n = String(v == null ? '' : v).replace(/\D/g, ''); return (n || '0').padStart(4, '0').slice(-4) }
export function today() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
export function nowIso() { return new Date().toISOString() }
export function slugify(text, fallback) {
  const s = String(text || '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '')
  return (s || fallback || 'item').slice(0, 40)
}
/** 学号/身份标识：只允许安全字符，避免用它拼路径时被穿越 */
export function safeId(v) {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9_\u4e00-\u9fa5.-]/g, '').replace(/^\.+/, '')
  return s.slice(0, 40)
}
export function extAllowed(nm) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nm || ''))
  return m ? ALLOWED_EXT.split(',').map((x) => x.trim().toLowerCase()).indexOf('.' + m[1].toLowerCase()) >= 0 : false
}

function yamlValue(raw) {
  const v = String(raw == null ? '' : raw).trim()
  if (!v) return ''
  if (v[0] === '"' && v[v.length - 1] === '"') return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  if (v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1)
  if (v[0] === '[') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : v } catch (e) { return v } }
  return v
}
export function parseMarkdown(text) {
  const n = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(n)
  if (!m) return { fields: {}, body: n }
  const fields = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/.exec(line)
    if (kv) fields[kv[1]] = yamlValue(kv[2])
  }
  return { fields, body: n.slice(m[0].length) }
}
export function parseSections(body) {
  const out = []
  const text = String(body == null ? '' : body)
  const re = /^##\s+(.+)$/gm
  const hits = []
  let m = re.exec(text)
  while (m !== null) { hits.push({ title: m[1].trim(), start: m.index, end: m.index + m[0].length }); m = re.exec(text) }
  for (let i = 0; i < hits.length; i += 1) {
    const stop = i + 1 < hits.length ? hits[i + 1].start : text.length
    out.push({ title: hits[i].title, content: text.slice(hits[i].end, stop).trim() })
  }
  if (!out.length && text.trim()) out.push({ title: '正文', content: text.trim() })
  return out
}
export function sectionOf(body, title, fb) {
  for (const s of parseSections(body)) if (s.title === title) return s.content || fb
  return fb
}
export function fold(title, value) {
  const t = String(value == null ? '' : value).replace(/\s+$/, '')
  return t ? '## ' + title + '\n\n' + t + '\n' : ''
}
const esc = (v) => '"' + oneLine(v).replace(/"/g, "'") + '"'
export function serialize(fields, body) {
  const order = ['id', 'title', 'summary', 'source', 'module', 'lesson', 'type', 'severity', 'status',
    'created', 'updated', 'reporter', 'student', 'audit', 'owner', 'related_files', 'ai', 'tokens',
    'faq_id', 'linked_issue', 'common']
  const lines = ['---']
  for (const k of order) {
    const v = fields[k]
    if (v === undefined || v === null || v === '') continue
    lines.push(k + ': ' + (Array.isArray(v) ? JSON.stringify(v) : esc(v)))
  }
  lines.push('---', '')
  return lines.join('\n') + String(body || '').replace(/^\n+/, '')
}
export function pickEnum(v, allowed, fallback) {
  const s = oneLine(v)
  return allowed.indexOf(s) >= 0 ? s : fallback
}

// ── 追问线程（结构化存 JSON，和给人读的 md 分开）──────────────
// 为什么不用 md 里的一个小节存线程：多轮问答里有代码块、$公式$、换行，
// 塞进 `## 追问记录` 再解析回来非常容易出错（转义、缩进、空行都会被吃掉）。
// md 保持「给人看」，线程用 JSON 保持「给程序读写」。
export function threadPathFor(itemRel) { return itemRel.replace(/\.md$/i, '') + '.thread.json' }
export function readThread(absThread) {
  try { const j = JSON.parse(fs.readFileSync(absThread, 'utf8')); return Array.isArray(j.turns) ? j.turns : [] } catch (e) { return [] }
}
export function writeThread(absThread, turns) {
  fs.mkdirSync(path.dirname(absThread), { recursive: true })
  fs.writeFileSync(absThread, JSON.stringify({ updatedAt: nowIso(), turns }, null, 2), 'utf8')
}
/** 渲染线程为 md 小节（只用于人读，程序不从这里解析回去） */
export function renderThread(turns) {
  if (!turns.length) return ''
  const parts = ['## ' + THREAD_TITLE + '\n']
  turns.forEach((t, i) => {
    parts.push('**第 ' + (i + 1) + ' 轮追问**\n\n' + String(t.q || '').trim() + '\n')
    parts.push('**AI 作答**\n\n' + String(t.a || '').trim() + '\n')
  })
  return parts.join('\n')
}

// ── 模型调用 ──────────────────────────────────────────────────
export const STUDENT_SYSTEM = [
  '你是一位深度学习课程的助教，正在回答学生的提问。',
  '课程风格：必须回到数学推导与机制，不接受只给结论或只背 API。',
  '要求：',
  '1. 如果消息里带了图片，那是学生从课件里框选的一块，请先读懂它，再回答。',
  '2. 先直接回答学生问的那一点，不要复述问题。',
  '3. 数学公式一律用 LaTeX 写在 $...$ 或 $$...$$ 里。',
  '4. 指出学生可能的误区。',
  '5. 如果有可执行的自查步骤，给出具体做法。',
  '6. 控制在 400 字以内，不要客套话。',
  '7. 如果不确定，直接说不确定，不要编造。',
  '8. 这是多轮对话，后面每一轮都要给完整回答，不要说「同上」「见上」。',
].join('\n')

export const TITLE_SYSTEM = [
  '你在为深度学习课程的「问题池」拟标题。',
  '任务：把一次学生提问凝练成**一句话标题**，让老师扫一眼就知道这条问的是什么。',
  '',
  '风格要求（必须严格统一，因为整个问题池要看起来像一个人写的）：',
  '- 12–24 个汉字，单行，不加标点结尾。',
  '- 以问句或陈述句直陈困惑点，例如「为什么负特征值意味着鞍点」「Adam 二阶矩为何要偏差校正」。',
  '- 用课程里的术语，不要用「关于…的问题」「求助」「请问」这类外壳。',
  '- 不要包含课时号、日期、学号。',
  '',
  '只输出标题本身，不要引号、不要解释、不要换行。',
].join('\n')

export const SUMMARY_SYSTEM = [
  '你在为深度学习课程的问题池做「问题总结」。',
  '给你一段学生提问与 AI 的往返问答，请输出两到三句话的凝练总结，包含：',
  '① 学生真正卡住的概念是什么；② 结论是什么。',
  '风格与标题保持一致：直陈、用课程术语、不客套。不要写「该学生」「本文」这类词。',
  '只输出总结正文，不要标题行。',
].join('\n')

export const GRADER_SYSTEM = [
  '你是一位深度学习课程的助教，正在批改学生作业。',
  '下面会给你：① 本课时教案（含学习目标与验收标准）② 学生提交的代码 ③ 批改维度表。',
  '批改原则（很重要）：',
  '- 以教案为准。教案要求学生用的方法（例如“仅用 NumPy 手写”），就不要因为学生用了 sklearn 而给高分——那正是本次要检查的对齐点。',
  '- 逐条对照教案的《验收标准》小节，逐条给出通过/不通过/无法判断与证据。',
  '- 不要给出最终分数或等级。你只做客观初筛与证据列举，成绩判定由教师完成。',
  '- 指出具体行号或代码片段作为证据；没有证据的判断不要写。',
  '- 数学式子用 LaTeX（$...$）。',
  '- 最后用 `### 问题清单` 起一节，逐条列出发现的问题，每条一行，格式：`- [严重度] 问题描述（证据）`。严重度取 阻塞/高/中/低。',
  '  这一节会被程序解析出来存进问题池，所以格式必须严格。',
].join('\n')

/**
 * 从批改正文里取出《问题清单》小节。
 *
 * ⚠️ 这里曾经错过一次：GRADER_SYSTEM 要求模型输出 `### 问题清单`（三级标题，
 *    因为它挂在批改正文的二级结构下面），但取小节用的 sectionOf() 只认 `##`。
 *    结果模型老老实实按格式输出了，解析器却一条也取不到 —— 问题池永远是空的，
 *    而正文看起来完全正常，极难发现。
 *    教训：解析器的语义必须和提示词的字面要求对齐；对齐不了就在解析侧兼容。
 */
export function issueSection(answer) {
  const text = String(answer || '')
  // 先按 ## （模型有时会升格），再按 ###
  const byTwo = sectionOf(text, '问题清单', '')
  if (oneLine(byTwo)) return byTwo
  const re = /^#{2,4}\s*问题清单\s*$/m
  const m = re.exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const next = /^#{2,4}\s+\S/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

/** 解析批改输出末尾的《问题清单》小节，转成结构化问题 */
export function parseIssueList(answer) {
  const body = issueSection(answer)
  const out = []
  for (const line of String(body).split('\n')) {
    const m = /^\s*[-*]\s*\[(阻塞|高|中|低)\]\s*(.+?)\s*$/.exec(line)
    if (m) out.push({ severity: m[1], text: oneLine(m[2]) })
  }
  return out
}

/** 一次模型调用：返回文本 + token 用量。用量用于把费用归到发起方。 */
export async function callModel(ctx, { system, messages, trace }) {
  const log = trace || []
  const llm = ctx.get('llm')
  if (llm === undefined) { log.push('llm 不可用'); throw new Error('llm 服务不可用') }
  const selector = ctx.get('agentDefaultModel')
  let sel = null
  try { sel = selector && typeof selector.currentSelection === 'function' ? selector.currentSelection() : null } catch (e) { sel = null }
  const provider = sel && sel.provider ? sel.provider : 'deepseek-official'
  const model = sel && sel.model ? sel.model : 'deepseek-flash'
  log.push('模型: ' + provider + '/' + model)
  let answer = ''
  let failure = ''
  const usage = { inputTokens: 0, outputTokens: 0 }
  for await (const chunk of llm.stream({ provider, model, messages, system })) {
    if (chunk.type === 'text-delta') answer += chunk.text
    if (chunk.type === 'usage' && chunk.usage) {
      usage.inputTokens += Number(chunk.usage.inputTokens || 0)
      usage.outputTokens += Number(chunk.usage.outputTokens || 0)
    }
    if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
      failure = (chunk.reason.failure && chunk.reason.failure.message) || 'unknown'
    }
  }
  if (failure) { log.push('模型报错: ' + failure); throw new Error('模型返回错误：' + failure) }
  if (!oneLine(answer)) throw new Error('模型未返回文本内容')
  log.push('回包字符数: ' + answer.length + ' · tokens in/out ' + usage.inputTokens + '/' + usage.outputTokens)
  return { text: answer.trim(), usage, provider, model }
}

export function msg(role, text, provider, model) {
  const base = { id: 'cip-' + Math.random().toString(36).slice(2), role, content: [{ type: 'text', text }] }
  if (role === 'assistant') base.source = { kind: 'model', provider: provider || 'unknown', model: model || 'unknown' }
  else base.source = { kind: 'plugin', plugin: 'course-panel' }
  return base
}

// ── 核心：把所有共享能力装进一个 ctx ───────────────────────────
/**
 * @param ctx     Cordis 上下文
 * @param opts.prefix      本插件的路由前缀，例如 '/cip-stu'
 * @param opts.role        'student' | 'teacher'
 * @param opts.pkgRoot     本插件包根（用于找自带的 katex/css）
 * @param opts.label       日志用名字
 */
export function createCore(ctx, opts) {
  const { prefix, role, pkgRoot, label } = opts
  const isTeacher = role === 'teacher'
  const WS = resolveWorkspace()
  const WORKSPACE = WS.dir
  const fsMod = ctx.get('fs')
  // katex 与样式表是**核心包**自带的，不是各插件自带的 —— 只维护一份。
  // （pkgRoot 是各插件自己的包根，那里只有它的 client.js。）
  const CORE_LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib')
  const katexDir = process.env.CIP_KATEX_DIR || path.join(CORE_LIB, 'katex')
  const cache = {
    slides: null, slidesAt: 0, chapterCode: '', mediaOk: null, mediaError: '',
    index: null, indexAt: 0, tree: null, katexOk: fs.existsSync(path.join(katexDir, 'katex.min.js')),
  }
  const P = {
    media: prefix + '-media', katex: prefix + '-katex', css: prefix + '.css', api: prefix + '-api',
  }
  if (!cache.mediaOk && ctx.webServer !== undefined) cache.mediaOk = true
  if (!cache.mediaOk) cache.mediaError = 'webServer 不可用'

  const abs = (rel) => (/^[A-Za-z]:/.test(rel) ? rel : WORKSPACE.replace(/[\\/]+$/, '') + '\\' + rel)
  const readText = (rel) => fs.readFileSync(abs(rel), 'utf8')
  const writeText = (rel, c) => { const p = abs(rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') }
  const exists = (rel) => fs.existsSync(abs(rel))
  const listDir = (rel) => { try { return fs.readdirSync(abs(rel), { withFileTypes: true }) } catch (e) { return [] } }

  // ── 课程结构 ──
  async function loadIndex() {
    if (cache.index && Date.now() - cache.indexAt < 120000) return cache.index
    if (!exists(INDEX_REL)) return null
    const data = JSON.parse(readText(INDEX_REL))
    cache.index = data; cache.indexAt = Date.now(); cache.tree = null
    return data
  }
  function buildTree(idx) {
    if (!idx) return null
    const mods = (idx.modules || []).map((m) => ({
      name: m.name, theme: m.theme || '', range: m.range || '', dir: m.dir || '', planDir: m.planDir || '',
      lessons: (m.lessons || []).map((l) => Object.assign({}, l, {
        // 索引里 lesson.plan 就是文件名；有值且磁盘上在，才算这份教案真的存在
        hasPlan: !!(l.plan && fs.existsSync(abs(m.dir + '\\' + m.planDir + '\\' + l.plan))),
        planPath: l.plan ? (m.dir + '\\' + m.planDir + '\\' + l.plan) : '',
      })),
    }))
    return { course: idx.course, totalLessons: idx.totalLessons, modules: mods, gradingDimensions: idx.gradingDimensions || [] }
  }
  async function getTree() {
    if (cache.tree) return cache.tree
    cache.tree = buildTree(await loadIndex())
    return cache.tree
  }
  async function getSlides(chapter) {
    const ch = CHAPTERS.indexOf(oneLine(chapter)) >= 0 ? oneLine(chapter) : CHAPTERS[1]
    if (cache.chapterCode === ch && cache.slides && Date.now() - cache.slidesAt < 60000) return cache.slides
    const rel = SLIDES_DIR + '\\' + ch + '.json'
    if (!exists(rel)) return null
    const data = JSON.parse(readText(rel))
    data.chapter = ch
    // ⚠️ 绝不改写 m.file。客户端把它当**裸文件名**再拼路由；
    //    曾经在这里拼过一次前缀，结果双前缀 → 媒体路由 400 → 所有图片都加载不出来。
    for (const slide of data.slides) for (const m of slide.media) if (!m.file) m.file = null
    cache.slides = data; cache.slidesAt = Date.now(); cache.chapterCode = ch
    return data
  }

  // ── 教案与材料 ──
  /** 公开仓里的 课程.json 带 planPath，是学生端最可靠的「课时→教案」映射 */
  function planFromCourseJson(lessonNo) {
    for (const rel of ['课程.json', '课程中心\\课程.json']) {
      if (!exists(rel)) continue
      try {
        const j = JSON.parse(readText(rel))
        for (const mod of j.modules || []) {
          for (const l of mod.lessons || []) {
            if (Number(l.no) === Number(lessonNo) && l.planPath) {
              const rel2 = String(l.planPath).replace(/\//g, '\\')
              if (fs.existsSync(abs(rel2))) return rel2
            }
          }
        }
      } catch (e) { /* 换下一个候选 */ }
    }
    return ''
  }
  /**
   * 按课时号找教案。
   * 三条路，按可靠性排序：
   *   1. 公开仓的 课程.json（学生端就靠这条 —— 他们的 clone 里没有原始模块目录）
   *   2. 索引里的 m.dir\m.planDir\l.plan（老师机上是这条）
   *   3. 在 教案\<模块>\ 下按「课时N_*.md」找（兜底）
   */
  async function planPathFor(lessonNo) {
    const fromJson = planFromCourseJson(lessonNo)
    if (fromJson) return fromJson
    const idx = await loadIndex()
    for (const m of (idx && idx.modules) || []) {
      for (const l of m.lessons || []) {
        if (Number(l.no) !== Number(lessonNo)) continue
        const rel = m.dir + '\\' + m.planDir + '\\' + (l.plan || '')
        if (l.plan && fs.existsSync(abs(rel))) return rel
        const hit = listDir(m.dir + '\\' + m.planDir)
          .map((e) => e.name)
          .find((n) => /^课时(\d+)_/.test(n) && Number(/^课时(\d+)_/.exec(n)[1]) === Number(lessonNo))
        if (hit) return m.dir + '\\' + m.planDir + '\\' + hit
      }
    }
    for (const d of listDir('教案')) {
      if (!d.isDirectory()) continue
      const hit = listDir('教案\\' + d.name)
        .map((e) => e.name)
        .find((n) => /^课时(\d+)_/.test(n) && Number(/^课时(\d+)_/.exec(n)[1]) === Number(lessonNo))
      if (hit) return '教案\\' + d.name + '\\' + hit
    }
    return ''
  }
  async function listDocs() {
    const out = []
    const idx = await loadIndex()
    for (const m of (idx && idx.modules) || []) {
      for (const e of listDir(m.dir + '\\' + m.planDir)) {
        if (e.isFile() && /^课时\d+_.+\.md$/.test(e.name)) {
          out.push({ path: m.dir + '\\' + m.planDir + '\\' + e.name, name: e.name, kind: m.name, module: m.name })
        }
      }
    }
    // 公开仓里教案被平铺在 教案/<模块>/ 下，学生端没有原始模块目录，也一并收进来
    for (const d of listDir('教案')) {
      if (!d.isDirectory()) continue
      for (const e of listDir('教案\\' + d.name)) {
        if (e.isFile() && /\.md$/i.test(e.name)) {
          out.push({ path: '教案\\' + d.name + '\\' + e.name, name: e.name, kind: d.name, module: d.name })
        }
      }
    }
    for (const e of listDir('课程中心')) {
      if (e.isFile() && /\.md$/i.test(e.name)) out.push({ path: '课程中心\\' + e.name, name: e.name, kind: '课程中心' })
    }
    // 同一课时在原始模块目录和公开仓平铺目录里各有一份时，去掉重复（按文件名）
    const seen = new Set()
    return out.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)))
  }

  // ── 问题条目：公共面 + 学生私有面 ────────────────────────────
  function itemDirs() {
    const out = []
    if (exists(PUBLIC_ITEMS_REL)) out.push({ rel: PUBLIC_ITEMS_REL, scope: 'public' })
    for (const e of listDir(STUDENT_ITEMS_REL)) {
      if (e.isDirectory()) out.push({ rel: STUDENT_ITEMS_REL + '\\' + e.name, scope: 'student', student: e.name })
    }
    // 兼容旧布局（没有公共/学生分层时，条目直接放在 课程问题池\问题条目）
    if (exists('课程问题池\\问题条目')) out.push({ rel: '课程问题池\\问题条目', scope: 'legacy' })
    return out
  }
  async function listItems() {
    const items = []
    for (const d of itemDirs()) {
      for (const e of listDir(d.rel)) {
        if (!e.isFile() || !/\.md$/i.test(e.name)) continue
        const rel = d.rel + '\\' + e.name
        try {
          const doc = parseMarkdown(readText(rel))
          const f = doc.fields
          items.push({
            path: rel, scope: d.scope, student: d.student || f.student || '',
            id: f.id || '', title: f.title || e.name, summary: f.summary || '',
            module: f.module || '', lesson: f.lesson || '', type: f.type || '',
            severity: f.severity || '', status: f.status || '', audit: f.audit || '',
            created: f.created || '', updated: f.updated || '', ai: f.ai || '',
            tokens: f.tokens || '', common: f.common || '',
            turns: readThread(abs(threadPathFor(rel))).length,
          })
        } catch (err) { /* 单条坏了不影响整池 */ }
      }
    }
    items.sort((a, b) => String(b.created + b.id).localeCompare(String(a.created + a.id)))
    return items
  }
  async function nextId(scope, student) {
    const all = await listItems()
    let max = 0
    for (const it of all) { const n = Number(String(it.id).replace(/\D/g, '')); if (n > max) max = n }
    void scope; void student
    return pad4(max + 1)
  }
  /** 读取一条条目：md + 线程 */
  function readItem(rel) {
    const doc = parseMarkdown(readText(rel))
    return { rel, fields: doc.fields, body: doc.body, turns: readThread(abs(threadPathFor(rel))) }
  }
  /** 写回一条条目：md（含线程的可读渲染）+ thread.json */
  function writeItem(rel, fields, sections, turns) {
    const parts = []
    for (const t of SECTION_ORDER) if (sections[t] !== undefined && sections[t] !== '') parts.push(fold(t, sections[t]))
    parts.push(renderThread(turns || []))
    writeText(rel, serialize(fields, parts.filter(Boolean).join('\n')))
    if (turns && turns.length) writeThread(abs(threadPathFor(rel)), turns)
  }
  /** 从既有 md 里取出各小节（丢掉线程小节，它另有存放） */
  function sectionsOf(body) {
    const s = {}
    for (const x of parseSections(body)) if (x.title !== THREAD_TITLE) s[x.title] = x.content
    return s
  }
  function itemRelFor(fields, title, scope, student) {
    const dir = scope === 'public' ? PUBLIC_ITEMS_REL : (STUDENT_ITEMS_REL + '\\' + safeId(student || 'anonymous'))
    return dir + '\\' + today() + '-' + fields.id + '-' + slugify(title, fields.id) + '.md'
  }

  // ── 学生提交 ──
  function submitDirOf(student) { return SUBMIT_ROOT_REL + '\\' + safeId(student || 'anonymous') }
  function listSubmissions(student) {
    const dir = student ? submitDirOf(student) : SUBMIT_ROOT_REL
    const out = []
    const walk = (rel, who) => {
      for (const e of listDir(rel)) {
        if (e.isDirectory()) { walk(rel + '\\' + e.name, who || e.name); continue }
        if (!e.isFile()) continue
        out.push({ path: rel + '\\' + e.name, name: e.name, student: who || '', bytes: (() => { try { return fs.statSync(abs(rel + '\\' + e.name)).size } catch (x) { return 0 } })() })
      }
    }
    walk(dir, student || '')
    return out
  }

  // ── 路由装配 ─────────────────────────────────────────────────
  const routes = []
  function reg(r) { routes.push(r); return r }

  function registerStatic() {
    // 样式表：老师机上可指向工作区源文件（改完刷新即生效），否则用核心包内的副本
    const cssCandidates = [abs('课程中心\\_插件源码\\panel.css'), path.join(CORE_LIB, 'panel.css')]
    reg({ kind: 'prefix', path: P.css, handler: (req, res) => {
      for (const p of cssCandidates) {
        try {
          const bytes = fs.readFileSync(p)
          res.statusCode = 200; res.setHeader('Content-Type', 'text/css; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache'); res.end(bytes); return
        } catch (e) { /* 试下一个 */ }
      }
      res.statusCode = 404; res.end('not found')
    } })
    const allow = { 'katex.min.js': 'application/javascript; charset=utf-8', 'katex.min.css': 'text/css; charset=utf-8' }
    reg({ kind: 'prefix', path: P.katex, handler: (req, res) => {
      let nm = ''
      try {
        let rel = String(req.url || '')
        if (rel.indexOf(P.katex) === 0) rel = rel.slice(P.katex.length)
        if (rel[0] === '/') rel = rel.slice(1)
        const qi = rel.indexOf('?'); if (qi >= 0) rel = rel.slice(0, qi)
        nm = decodeURIComponent(rel)
      } catch (e) { nm = '' }
      if (!Object.prototype.hasOwnProperty.call(allow, nm)) { res.statusCode = 404; res.end('not found'); return }
      const full = path.join(katexDir, nm)
      if (path.dirname(path.resolve(full)) !== path.resolve(katexDir)) { res.statusCode = 404; res.end('not found'); return }
      try {
        const bytes = fs.readFileSync(full)
        res.statusCode = 200; res.setHeader('Content-Type', allow[nm])
        res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(bytes)
      } catch (e) { res.statusCode = 404; res.end('not found') }
    } })
  }

  function registerMedia() {
    const mediaDirRel = MEDIA_DIR_REL
    reg({ kind: 'prefix', path: P.media, handler: (req, res) => {
      let nm = ''
      try {
        let rel = String(req.url || '')
        if (rel.indexOf(P.media) === 0) rel = rel.slice(P.media.length)
        if (rel[0] === '/') rel = rel.slice(1)
        const qi = rel.indexOf('?'); if (qi >= 0) rel = rel.slice(0, qi)
        nm = decodeURIComponent(rel)
      } catch (e) { nm = '' }
      nm = nm.replace(/\\/g, '/')
      const segs = nm.split('/')
      if (!nm || nm.indexOf('..') >= 0 || segs.length !== 2 || CHAPTERS.indexOf(segs[0]) < 0 || !segs[1]) {
        res.statusCode = 400; res.end('bad name'); return
      }
      const dirAbs = abs(mediaDirRel + '\\' + segs[0])
      let useName = segs[1]
      let full = path.join(dirAbs, useName)
      if (!fs.existsSync(full)) {
        // 扩展名回退：JSON 里是抽取时的原始扩展名（.png/.gif），学生包里可能是 .webp
        const stem = useName.replace(/\.[^.]+$/, '')
        const hit = RASTER_EXT.map((x) => stem + x).find((x) => fs.existsSync(path.join(dirAbs, x)))
        if (hit) { useName = hit; full = path.join(dirAbs, hit) }
        else if (VIDEO_EXT.test(useName)) {
          // 视频有意不随课程包分发：返回一张说明牌，比破图有用
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180">'
            + '<rect width="640" height="180" fill="#f4f4f5" stroke="#d4d4d8"/>'
            + '<text x="320" y="80" text-anchor="middle" font-size="17" fill="#52525b" font-family="sans-serif">此视频未随课程包分发</text>'
            + '<text x="320" y="112" text-anchor="middle" font-size="13" fill="#71717a" font-family="sans-serif">' + oneLine(useName) + '</text>'
            + '<text x="320" y="140" text-anchor="middle" font-size="12" fill="#a1a1aa" font-family="sans-serif">原始 PPT 内嵌的录屏片段，体积过大；需要请看课程录制</text>'
            + '</svg>'
          res.statusCode = 200; res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
          res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(svg); return
        }
      }
      try {
        const bytes = fs.readFileSync(full)
        cache.mediaOk = true
        res.statusCode = 200
        res.setHeader('Content-Type', /\.png$/i.test(useName) ? 'image/png'
          : (/\.jpe?g$/i.test(useName) ? 'image/jpeg'
            : (/\.gif$/i.test(useName) ? 'image/gif'
              : (/\.webp$/i.test(useName) ? 'image/webp'
                : (/\.svg$/i.test(useName) ? 'image/svg+xml'
                  : (/\.mp4$/i.test(useName) ? 'video/mp4'
                    : (/\.webm$/i.test(useName) ? 'video/webm' : 'application/octet-stream')))))))
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.end(bytes)
      } catch (error) {
        cache.mediaError = '读图失败 ' + oneLine(segs[0] + '/' + segs[1]) + '：' + oneLine(error && error.message)
        res.statusCode = 404; res.end('not found')
      }
    } })
  }

  function registerApi(handlers) {
    const readBody = (req) => new Promise((resolve) => {
      const chunks = []; let n = 0
      req.on('data', (c) => { n += c.length; if (n > 16 * 1024 * 1024) { req.destroy(); return } chunks.push(c) })
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { resolve({}) } })
      req.on('error', () => resolve({}))
    })
    reg({ kind: 'prefix', path: P.api, handler: async (req, res) => {
      let action = ''
      try {
        let rel = String(req.url || '')
        if (rel.indexOf(P.api) === 0) rel = rel.slice(P.api.length)
        if (rel[0] === '/') rel = rel.slice(1)
        const qi = rel.indexOf('?'); if (qi >= 0) rel = rel.slice(0, qi)
        action = decodeURIComponent(rel)
      } catch (e) { action = '' }
      const out = { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      try {
        const fn = handlers[action]
        if (!fn) { res.statusCode = 404; res.end(JSON.stringify({ error: '未知动作：' + action })) ; return }
        out.body = await fn(await readBody(req))
      } catch (error) {
        res.statusCode = 200
        res.end(JSON.stringify({ error: oneLine(error && error.message) || '未知错误' }))
        return
      }
      res.statusCode = 200
      res.end(JSON.stringify(out.body === undefined ? { ok: true } : out.body))
    } })
  }

  /** ctx.effect 包装注册，保证卸载时路由跟着撤掉 */
  function mount() {
    registerStatic(); registerMedia()
    for (const r of routes) ctx.effect(() => ctx.webServer.register(r), label + ' ' + r.path)
  }

  return {
    // 位置
    WORKSPACE, WS, P, role, isTeacher, pkgRoot,
    // 文件
    abs, readText, writeText, exists, listDir,
    // 课程
    loadIndex, getTree, getSlides, listDocs, planPathFor,
    // 条目
    listItems, readItem, writeItem, sectionsOf, itemRelFor, nextId, itemDirs,
    // 线程读写：各插件要按轮次判断「老师答过没有」，所以必须从这里暴露出去。
    // （曾经漏了这两个，调用方 core.readThread(...) 抛 TypeError，而调用处恰好
    //   是个 try/catch —— 于是「教师已答复」标记永远是 false，没人发现。）
    readThread, threadPathFor,
    PUBLIC_ITEMS_REL, STUDENT_ITEMS_REL, SUBMIT_ROOT_REL,
    submitDirOf, listSubmissions,
    // 路由
    registerApi, registerStatic, registerMedia, mount, routes, readBodyForTest: null,
    // 诊断
    info: () => ({
      workspace: WORKSPACE, workspaceHow: WS.how, workspaceTried: WS.tried,
      workspaceLooksValid: fs.existsSync(path.join(WORKSPACE, '课程中心')),
      role, label, prefix,
      mediaOk: cache.mediaOk === true, mediaError: cache.mediaError,
      katexOk: cache.katexOk, hasLlm: ctx.get('llm') !== undefined,
      chapters: CHAPTERS,
      defaults: { sources: SOURCES, modules: MODULES, types: TYPES, severities: SEVERITIES, statuses: STATUSES },
      publicDir: PUBLIC_ITEMS_REL, studentDir: STUDENT_ITEMS_REL, submitDir: SUBMIT_ROOT_REL,
      maxSubBytes: MAX_SUB_BYTES, allowedExt: ALLOWED_EXT, maxTurns: MAX_THREAD_TURNS,
      routes: routes.map((r) => r.path),
    }),
    warn() {
      if (!fs.existsSync(path.join(WORKSPACE, '课程中心'))) {
        console.warn('[' + label + '] ⚠ 工作区里没有「课程中心」目录，面板会是空的。试过：')
        for (const t of WS.tried) console.warn('[' + label + ']   ' + t)
      }
      if (!cache.katexOk) console.warn('[' + label + '] ⚠ 找不到 katex，公式将无法渲染')
    },
  }
}

export { DEFAULT_WORKSPACE }
