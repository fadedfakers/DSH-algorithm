/**
 * dsh-course-panel —— 宿主半区
 *
 * 这是动态插件 cip-1 的「固化」形态：一个可安装的 DSH Profile Bundle。
 *
 * ⚠️ 与动态版本最重要的一处差异：
 *   动态沙箱里有 harness.handle() 这个进程内 IPC，正式插件里 **没有** ——
 *   harness 不是任何包的导出（已核实 @deepseek-ai/dsh-scope 不导出它）。
 *   所以原来 15 个 harness.handle 全部改写成 /cip-api/* 的 HTTP 路由，
 *   客户端从 host.call() 改为 fetch()。这是本次固化唯一的架构性改动。
 *
 * 提供的路由（前缀，由 dsh-host-webserver 匹配 pathname.startsWith(prefix + '/')）：
 *   /cip-media/<章>/<文件名>   课件图片（每章独立目录，防同名覆盖）
 *   /cip-katex/katex.min.{js,css}
 *   /cip-panel.css             面板样式表（白名单搬运，便于热改）
 *   /cip-api/<action>          数据面：info/tree/slides/pool/docs/submission...
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── 工作区解析（学生端能不能跑起来，全靠这里）─────────────────────
// 背景：这个插件本来只为老师自己那台机器写，所以工作区是硬编码的。
// 学生把插件装到自己机器上时，那个路径根本不存在 —— 面板会读到空目录，
// 表现为「一条问题都没有、课件 0 页」，但没有任何报错。这类失败最难查。
//
// 解析顺序（先具体、后兜底）：
//   1. CIP_WORKSPACE 环境变量        —— 显式指定，优先级最高
//   2. CIP_WORKSPACE_FILE 指向的配置文件 —— install.ps1 写下来的，学生走这条
//   3. 默认的教师工作区              —— 只为兼容老师原来那台机器
// 无论走哪条，都要**验证目录真的存在**，否则继续往后退。
const DEFAULT_WORKSPACE = 'C:\\Users\\Administrator\\Desktop\\暑期课程'
const HERE = path.dirname(fileURLToPath(import.meta.url))
// HERE = <包根>/src 或 <包根>/lib（打散后两种都可能），包根始终是它的上一级
const PKG_ROOT = path.resolve(HERE, '..')
// 插件自带的静态资源（katex、面板样式表）放在包内，
// 这样学生端不依赖 profile 里恰好装了哪个版本的 katex。
const BUNDLED_DIR = path.join(PKG_ROOT, 'lib')

function readWorkspaceFile(p) {
  try {
    const t = fs.readFileSync(p, 'utf8').trim()
    if (!t) return null
    // 允许文件里带注释行与 BOM（学生手改时很容易留下这些）
    const first = t.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').trim())
      .find((l) => l && l[0] !== '#' && l[0] !== ';')
    return first || null
  } catch (e) { return null }
}

function resolveWorkspace() {
  const tried = []
  const candidates = []
  if (process.env.CIP_WORKSPACE) candidates.push(['环境变量 CIP_WORKSPACE', process.env.CIP_WORKSPACE])
  const wf = process.env.CIP_WORKSPACE_FILE || path.join(os.homedir(), '.dsh', 'cip-workspace.txt')
  const fromFile = readWorkspaceFile(wf)
  if (fromFile) candidates.push(['配置文件 ' + wf, fromFile])
  candidates.push(['内置默认值（教师机）', DEFAULT_WORKSPACE])

  for (const [how, dir] of candidates) {
    const abs = path.resolve(dir)
    // 判据不是「目录存在」而是「它像不像课程工作区」——
    // 学生如果把路径写成 C:\ 也能存在，但那不是工作区，退回去比读空目录好。
    const looksRight = fs.existsSync(path.join(abs, '课程中心'))
    tried.push(how + ' → ' + abs + (looksRight ? ' ✓' : ' ✗'))
    if (looksRight) return { dir: abs, how: how, tried: tried }
  }
  // 全都不像：仍然返回第一个候选，让面板能显示出来、把 tried 暴露给用户看
  return { dir: path.resolve(candidates[0][1]), how: candidates[0][0] + '（未验证）', tried: tried }
}

const WS = resolveWorkspace()
const WORKSPACE = WS.dir

// ── 角色与课程码（设计原则.md 第 0/1 条）──────────────────────────
// 学生在本机跑 DSH、用自己的 API Key；老师负责审计与策展。
// 角色只影响「界面暴露什么」，不影响安全边界 —— 安全边界由仓库可见性决定。
//
// ⚠️ 缺省必须是 student（fail-closed）。学生拿到 tarball 直接跑，不会有任何环境变量；
//    如果把缺省写成 teacher，每个学生开箱即得教师权限（能批改、能改教案条目）。
//    反过来写错的代价只是老师首次启动要多设一个变量——两种错误代价不对称，所以缺省取窄的。
const ROLE = (process.env.CIP_ROLE || '').toLowerCase() === 'teacher' ? 'teacher' : 'student'
const COURSE_CODE = process.env.CIP_COURSE_CODE || ''
// 课程码是「配置包」不是权限凭据：只用来告诉学生读哪个仓、插件哪个版本、自己是什么角色。
// 真正的可见性由仓库本身决定（公开仓只含已发布内容）。
const isStudent = () => ROLE === 'student'
function requireTeacher(action) {
  if (isStudent()) throw new Error('当前是学生端，不允许「' + action + '」')
}
const ITEMS_REL = '课程问题池\\问题条目'
const SLIDES_DIR = '课程中心\\预览数据'
const CHAPTERS = ['第一章', '第二章', '第三章']
const MEDIA_DIR_REL = '课程中心\\预览数据\\media'
const INDEX_REL = '课程中心\\课程结构索引.json'
const SUBMIT_DIR = '作业提交'
// 样式表：老师机上仍可指向工作区里的源文件（改完刷新即生效，便于调样式）；
// 学生机没有那个目录，回落到包内自带的副本。
const PANEL_CSS_REL = '课程中心\\_插件源码\\panel.css'
const BUNDLED_CSS = path.join(BUNDLED_DIR, 'panel.css')
const BUNDLED_KATEX_DIR = path.join(BUNDLED_DIR, 'katex')
// katex 允许用环境变量覆盖（例如想换版本），默认用包内自带的那份
const KATEX_DIR = process.env.CIP_KATEX_DIR || BUNDLED_KATEX_DIR

const MEDIA_PREFIX = '/cip-media'
const KATEX_PREFIX = '/cip-katex'
const CSS_PATH = '/cip-panel.css'
const API_PREFIX = '/cip-api'
const MEDIA_MAX_BYTES = 64 * 1024 * 1024

const MODULES = ['模块一', '模块二', '模块三', '模块四', '模块五']
const TYPES = ['概念问题', '代码报错', '环境问题', '数值稳定性', '作业疑问', '讲义问题', '内容建议']
const SEVERITIES = ['阻塞', '高', '中', '低']
const STATUSES = ['待处理', '已答复', '待复盘', '已沉淀', '转教案修订']
const SOURCES = ['课堂', '作业', 'B站评论', '私聊', '答疑课', '自测', '阅读器框选图区', '阅读器拖选文字']
const SECTION_ORDER = ['原始提问', '现象', '初步判断', 'AI 答复', '处理结论', '复盘']
const THREAD_TITLE = '追问记录'
const MAX_THREAD_TURNS = 8
// 作业提交上限：默认 4MB（含输出的 .ipynb 很容易超 512KB）。
// 可用环境变量 CIP_MAX_SUB_BYTES 覆盖。
const MAX_SUB_BYTES = Number(process.env.CIP_MAX_SUB_BYTES) > 0 ? Number(process.env.CIP_MAX_SUB_BYTES) : 4 * 1024 * 1024
// 只收文本类交付物。模型权重（.pth/.pt/.ckpt/.onnx）是二进制大文件，
// 不该进仓库也不该进这里——请走共享盘/对象存储。
const ALLOWED_EXT = (process.env.CIP_ALLOWED_EXT || '.py,.ipynb,.md,.txt,.yaml,.yml,.json,.csv,.tsv')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
function extAllowed(nm) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nm || ''))
  return m ? ALLOWED_EXT.indexOf('.' + m[1].toLowerCase()) >= 0 : false
}
const PLAN_NOISE = ['目标', '推导', '实操', '验收标准', '当堂交付物', '学习目标', '核心内容', '课堂实操', '当堂产出', '作业']

const STUDENT_SYSTEM = [
  '你是一位深度学习课程的助教，正在回答学生的提问。',
  '课程风格：必须回到数学推导与机制，不接受只给结论或只背 API。',
  '要求：',
  '1. 如果消息里带了图片，那是学生从课件里框选的一块，请先读懂它，再回答。',
  '2. 先直接回答学生问的那一点，不要复述问题。',
  '3. 数学公式一律用 LaTeX 写在 $...$ 或 $$...$$ 里。',
  '4. 指出学生可能的误区。',
  '5. 如果有可执行的自查步骤，给出具体做法。',
  '6. 控制在 250 字以内，不要客套话。',
  '7. 如果不确定，直接说不确定，不要编造。',
].join('\n')

const GRADER_SYSTEM = [
  '你是一位深度学习课程的助教，正在批改学生作业。',
  '下面会给你：① 本课时教案（含学习目标与验收标准）② 学生提交的代码 ③ 批改维度表。',
  '批改原则（很重要）：',
  '- 以教案为准。教案要求学生用的方法（例如“仅用 NumPy 手写”），就不要因为学生用了 sklearn 而给高分——那正是本次要检查的对齐点。',
  '- 逐条对照教案的《验收标准》小节，逐条给出通过/不通过/无法判断与证据。',
  '- 不要给出最终分数或等级。你只做客观初筛与证据列举，成绩判定由教师完成。',
  '- 指出具体行号或代码片段作为证据；没有证据的判断不要写。',
  '- 数学式子用 LaTeX（$...$）。',
].join('\n')

// ── 工具函数（与动态版一致，只把 sandbox 全局换成 node 标准能力）──
const oneLine = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
const pad4 = (v) => { const n = String(v == null ? '' : v).replace(/\D/g, ''); return (n || '0').padStart(4, '0').slice(-4) }
function yamlValue(raw) {
  let v = String(raw == null ? '' : raw).trim()
  if (!v) return ''
  if (v[0] === '"' && v[v.length - 1] === '"') return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  if (v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1)
  if (v[0] === '[') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : v } catch (e) { return v } }
  return v
}
function parseMarkdown(text) {
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
function parseSections(body) {
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
function sectionOf(body, title, fb) {
  for (const s of parseSections(body)) if (s.title === title) return s.content || fb
  return fb
}
function fold(title, value) {
  const t = String(value == null ? '' : value).replace(/\s+$/, '')
  return t ? '## ' + title + '\n\n' + t + '\n' : ''
}
const esc = (v) => '"' + oneLine(v).replace(/"/g, "'") + '"'
function serialize(fields, body) {
  const order = ['id', 'title', 'source', 'module', 'lesson', 'type', 'severity', 'status', 'created', 'updated', 'reporter', 'owner', 'related_files', 'ai', 'faq_id', 'linked_issue']
  const lines = ['---']
  for (const k of order) {
    const v = fields[k]
    if (v === undefined || v === null) continue
    lines.push(k + ': ' + (Array.isArray(v) ? JSON.stringify(v) : esc(v)))
  }
  lines.push('---', '')
  return lines.join('\n') + String(body || '').replace(/^\n+/, '')
}
function safeName(title, id) {
  const s = oneLine(title).replace(/[\\/:*?"<>|#\[\]()]/g, '').replace(/\s+/g, '-').slice(0, 40)
  return s || ('issue-' + id)
}
const pickEnum = (v, list, fb) => { const f = oneLine(v); return list.indexOf(f) >= 0 ? f : fb }
const today = () => new Date().toISOString().slice(0, 10)
function base64ToBytes(b64) {
  const bin = Buffer.from(String(b64 || '').replace(/^data:[^,]*,/, ''), 'base64')
  return new Uint8Array(bin)
}
function parseThread(body) {
  const raw = sectionOf(body, THREAD_TITLE, '')
  if (!raw) return []
  const out = []
  const re = /^###\s*Q(\d+)\s*(.*)$/gm
  const hits = []
  let m = re.exec(raw)
  while (m !== null) { hits.push({ q: m[2].trim(), start: m.index + m[0].length }); m = re.exec(raw) }
  for (let i = 0; i < hits.length; i += 1) {
    const stop = i + 1 < hits.length ? hits[i + 1].start : raw.length
    out.push({ q: hits[i].q, a: raw.slice(hits[i].start, stop).replace(/^###\s*Q\d+.*$/gm, '').trim() })
  }
  return out
}
function serializeThread(turns) {
  if (!turns.length) return ''
  const parts = []
  for (let i = 0; i < turns.length; i += 1) {
    parts.push('### Q' + (i + 1) + ' ' + oneLine(turns[i].q))
    parts.push('')
    parts.push(String(turns[i].a || '（无回答）').trim())
    parts.push('')
  }
  return '## ' + THREAD_TITLE + '\n\n' + parts.join('\n').trim() + '\n'
}
function sendJson(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data == null ? null : data))
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => { n += c.length; if (n > 16 * 1024 * 1024) { req.destroy(); return } chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

export const name = 'course-panel'
export const inject = ['webServer']

export function apply(ctx) {
  const cache = { slides: null, slidesAt: 0, chapterCode: '', mediaOk: null, mediaError: '', mediaProbe: '', index: null, indexAt: 0, tree: null }

  const fsMod = ctx.get('fs')
  async function readText(rel) { return await fsMod.readText(await fsMod.resolve(absOf(rel), { cwd: WORKSPACE })) }
  async function writeText(rel, content) { return await fsMod.writeText(await fsMod.resolve(absOf(rel), { cwd: WORKSPACE }), content) }
  async function exists(rel) { try { return (await fsMod.stat(await fsMod.resolve(absOf(rel), { cwd: WORKSPACE }))) !== undefined } catch (e) { return false } }
  async function listDir(rel) { try { return await fsMod.listDir(await fsMod.resolve(absOf(rel), { cwd: WORKSPACE })) } catch (e) { return [] } }
  function absOf(rel) { return /^[A-Za-z]:/.test(rel) ? rel : (WORKSPACE.replace(/[\\/]+$/, '') + '\\' + rel) }

  async function loadIndex() {
    if (cache.index && Date.now() - cache.indexAt < 120000) return cache.index
    if (!(await exists(INDEX_REL))) return null
    const data = JSON.parse(await readText(INDEX_REL))
    cache.index = data; cache.indexAt = Date.now(); cache.tree = null
    return data
  }

  async function knowledgeOf(modDir, planFile) {
    if (!planFile) return []
    const rel = modDir + '\\详细教案\\' + planFile
    if (!(await exists(rel))) return []
    try {
      const body = parseMarkdown(await readText(rel)).body
      const out = []
      for (const line of body.split('\n')) {
        const m2 = /^###?\s+(.+?)\s*$/.exec(line)
        if (!m2) continue
        const t = oneLine(m2[1]).replace(/^[一二三四五六七八九十]+[、.．]\s*/, '')
        if (!t || t.length < 4) continue
        if (PLAN_NOISE.indexOf(t) >= 0) continue
        if (out.indexOf(t) >= 0) continue
        out.push(t.slice(0, 26))
        if (out.length >= 6) break
      }
      return out
    } catch (e) { return [] }
  }

  async function buildTree() {
    if (cache.tree) return cache.tree
    const idx = await loadIndex()
    if (!idx) return null
    const mods = []
    for (const mod of idx.modules) {
      const lessons = []
      for (const ls of mod.lessons) {
        lessons.push({
          no: ls.no, title: ls.title, short: oneLine(ls.title).slice(0, 11),
          plan: ls.plan || '', hasPlan: !!ls.plan,
          knowledge: await knowledgeOf(mod.dir, ls.plan),
        })
      }
      const range = oneLine(String(mod.range || '').replace(/^课时\s*/, ''))
      mods.push({ id: mod.id, name: mod.name, dir: mod.dir, range, theme: mod.theme, lessons })
    }
    const tree = { course: idx.course, totalLessons: idx.totalLessons, gradingDimensions: idx.gradingDimensions, modules: mods }
    cache.tree = tree
    return tree
  }

  async function listItems() {
    const entries = await listDir(ITEMS_REL)
    const out = []
    for (const e of entries) {
      if (e.type !== 'file' || !/\.md$/i.test(e.name)) continue
      const rel = ITEMS_REL + '\\' + e.name
      try {
        const doc = parseMarkdown(await readText(rel))
        const f = doc.fields
        out.push({
          path: rel, name: e.name, size: e.size,
          id: pad4(f.id), title: oneLine(f.title) || e.name,
          source: oneLine(f.source), module: oneLine(f.module), lesson: oneLine(f.lesson),
          type: oneLine(f.type), severity: oneLine(f.severity), status: oneLine(f.status),
          created: oneLine(f.created), updated: oneLine(f.updated),
          reporter: oneLine(f.reporter), owner: oneLine(f.owner), ai: oneLine(f.ai),
          threadCount: parseThread(doc.body).length,
          excerpt: oneLine(sectionOf(doc.body, '原始提问', '')).slice(0, 90),
          sections: parseSections(doc.body).map((s) => ({ title: s.title, chars: s.content.length, filled: s.content.replace(/（待补充）/g, '').trim().length > 0 })),
        })
      } catch (error) {
        out.push({ path: rel, name: e.name, id: '????', title: e.name, parseError: oneLine(error && error.message) })
      }
    }
    out.sort((a, b) => String(b.id).localeCompare(String(a.id)))
    return out
  }

  async function listDocs() {
    const out = []
    for (const d of await listDir('.')) {
      if (d.type !== 'directory' || !/^模块/.test(d.name)) continue
      for (const f of await listDir(d.name + '\\详细教案')) {
        if (f.type === 'file' && /\.md$/i.test(f.name)) out.push({ group: d.name, kind: '教案', name: f.name, path: d.name + '\\详细教案\\' + f.name })
      }
      for (const f of await listDir(d.name + '\\代码示例')) {
        if (f.type === 'file' && /\.md$/i.test(f.name)) out.push({ group: d.name, kind: '代码示例', name: f.name, path: d.name + '\\代码示例\\' + f.name })
      }
    }
    for (const n of ['教学大纲-优化版.md', '课程生产流水线.md', '课程中心\\课程地图.md', '课程问题池\\README.md', '课程中心\\动态插件沙箱约束.md']) {
      if (await exists(n)) out.push({ group: '课程总览', kind: '大纲', name: n.split('\\').pop(), path: n })
    }
    return out
  }

  async function getSlides(chapter) {
    const ch = CHAPTERS.indexOf(oneLine(chapter)) >= 0 ? oneLine(chapter) : CHAPTERS[1]
    if (cache.chapterCode === ch && cache.slides && Date.now() - cache.slidesAt < 60000) return cache.slides
    const rel = SLIDES_DIR + '\\' + ch + '.json'
    if (!(await exists(rel))) return null
    const data = JSON.parse(await readText(rel))
    data.chapter = ch
    // ⚠️ 这里**不能**改写 m.file。曾经的写法是：
    //     if (m.file && cache.mediaOk === true) m.file = MEDIA_PREFIX + '/' + ch + '/' + m.file
    //   两个毛病，都真实发生过：
    //   1) 客户端把 m.file 当成**完整 URL** 直接塞给 <img src>（见 lib/client.js 的 MediaImage），
    //      所以这里再拼一次前缀会得到 /cip-media/第一章//cip-media/第一章/xxx.png，
    //      媒体路由按段数校验直接 400 —— 表现就是「所有图片都加载不出来」。
    //   2) mediaOk 一旦为 false 就把全部 file 清成 null，客户端于是显示「图片不可用」，
    //      而真正的原因（路由没注册好）被藏起来了，极难查。
    //   现在 file 一律保持 JSON 里的裸文件名，路由由客户端统一拼；
    //   图片到底能不能取到，由 HTTP 状态和客户端的 onError 如实反映。
    for (const slide of data.slides) {
      for (const m of slide.media) {
        if (!m.file) m.file = null
      }
    }
    cache.slides = data; cache.slidesAt = Date.now(); cache.chapterCode = ch
    return data
  }

  async function callModel(system, messages, trace) {
    const llm = ctx.get('llm')
    if (llm === undefined) { trace.push('llm 不可用'); throw new Error('llm 服务不可用') }
    const selector = ctx.get('agentDefaultModel')
    let sel = null
    try { sel = selector && typeof selector.currentSelection === 'function' ? selector.currentSelection() : null } catch (e) { sel = null }
    const provider = sel && sel.provider ? sel.provider : 'deepseek-official'
    const modelId = sel && sel.model ? sel.model : 'deepseek-flash'
    trace.push('模型: ' + provider + '/' + modelId)
    let answer = ''
    let failure = ''
    for await (const chunk of llm.stream({ provider, model: modelId, messages, system })) {
      if (chunk.type === 'text-delta') answer += chunk.text
      if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') failure = (chunk.reason.failure && chunk.reason.failure.message) || 'unknown'
    }
    if (failure) { trace.push('模型报错: ' + failure); throw new Error('模型返回错误：' + failure) }
    if (!oneLine(answer)) throw new Error('模型未返回文本内容')
    trace.push('回包字符数: ' + answer.length)
    return answer.trim()
  }

  function msg(role, text, provider, model) {
    const base = { id: 'cip-' + Math.random().toString(36).slice(2), role, content: [{ type: 'text', text }] }
    if (role === 'assistant') base.source = { kind: 'model', provider: provider || 'unknown', model: model || 'unknown' }
    else base.source = { kind: 'plugin', plugin: 'course-panel', form: 'notice', summary: '课程' }
    return base
  }

  function buildPrompt(question, anchorText) {
    const q = oneLine(question) || '这块内容是什么意思？请解释其中的关键推导。'
    const parts = ['【学生提问】', q]
    if (anchorText) parts.push('', '【学生指着的内容】', String(anchorText).slice(0, 1500))
    parts.push('', '（如果本次消息带图片，那是学生从课件里框选的一块，请先读懂它再回答。）')
    return parts.join('\n')
  }

  async function askStudent(question, anchorText, dataUrl, trace, history) {
    const messages = []
    if (history && history.length) {
      for (const turn of history) {
        messages.push(msg('user', String(turn.q || '')))
        messages.push(msg('assistant', String(turn.a || '')))
      }
    }
    const content = [{ type: 'text', text: buildPrompt(question, anchorText) }]
    let imageAttached = false
    if (dataUrl) {
      const attachments = ctx.get('attachments')
      if (attachments !== undefined) {
        try {
          const bytes = base64ToBytes(dataUrl)
          trace.push('截图字节: ' + bytes.length)
          const ref = await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'region.png' })
          trace.push('附件已保存: ' + ref.width + 'x' + ref.height)
          content.push({ type: 'image', attachment: ref })
          imageAttached = true
        } catch (error) { trace.push('附件保存失败: ' + oneLine(error && error.message)) }
      } else { trace.push('附件服务不可用') }
    } else { trace.push('本回合无截图') }
    const last = msg('user', buildPrompt(question, anchorText))
    last.content = content
    messages.push(last)
    trace.push('消息块: ' + content.map((c) => c.type).join(' + ') + ' / 共 ' + messages.length + ' 条')
    const answer = await callModel(STUDENT_SYSTEM, messages, trace)
    return { answer, imageAttached }
  }

  async function nextId() {
    let max = 0
    for (const it of await listItems()) { const n = parseInt(it.id, 10); if (!isNaN(n) && n > max) max = n }
    return String(max + 1).padStart(4, '0')
  }

  function composeBody(lead, answer) {
    return [
      '## 原始提问', '', String(lead || '').trim() || '（待补充）', '',
      '## 现象', '', '（待补充）', '',
      '## 初步判断', '', '（待补充）', '',
      '## AI 答复', '', String(answer || '（待补充）'), '',
      '## 处理结论', '', '（教师填写：去向未定）', '',
      '## 复盘', '', '（待补充）', '',
    ].join('\n').replace(/\n{3,}/g, '\n\n')
  }

  function rebuildWithThread(doc, turns) {
    const sections = {}
    for (const s of parseSections(doc.body)) if (s.title !== THREAD_TITLE) sections[s.title] = s.content
    const parts = []
    for (const t of SECTION_ORDER) if (sections[t] !== undefined) parts.push(fold(t, sections[t]))
    return serialize(doc.fields, parts.join('\n') + '\n' + serializeThread(turns))
  }

  const subDirOf = (lesson) => SUBMIT_DIR + '\\L' + String(lesson)

  async function planForLesson(lessonNo) {
    const idx = await loadIndex()
    if (!idx) return { error: '课程结构索引未找到：' + INDEX_REL }
    for (const mod of idx.modules) {
      for (const ls of mod.lessons) {
        if (ls.no !== lessonNo) continue
        if (!ls.plan) return { lesson: ls, mod, planText: '', missing: true }
        const rel = mod.dir + '\\详细教案\\' + ls.plan
        if (!(await exists(rel))) return { lesson: ls, mod, planText: '', missing: true }
        return { lesson: ls, mod, planText: await readText(rel), missing: false, rel }
      }
    }
    return { error: '索引里没有课时 ' + lessonNo }
  }

  // ── 数据面：原来的 harness.handle 全部变成这里的分发表 ──
  const handlers = {
    async info() {
      return {
        workspace: WORKSPACE, itemsDir: ITEMS_REL, submitDir: SUBMIT_DIR,
        // 工作区是怎么定下来的、试过哪些路径 —— 学生端「面板空白」时，
        // 这一项直接指出是路径没对上，不必再去猜。
        workspaceHow: WS.how, workspaceTried: WS.tried,
        workspaceLooksValid: fs.existsSync(path.join(WORKSPACE, '课程中心')),
        katexDir: KATEX_DIR, katexCssOk: fs.existsSync(path.join(KATEX_DIR, 'katex.min.css')),
        panelCssBundled: fs.existsSync(BUNDLED_CSS),
        mediaOk: cache.mediaOk === true, mediaError: cache.mediaError,
        hasAttachments: ctx.get('attachments') !== undefined,
        hasLlm: ctx.get('llm') !== undefined,
        hasFs: fsMod !== undefined,
        role: ROLE, courseCode: COURSE_CODE,
        canGrade: !isStudent(), canPublish: !isStudent(), canAudit: !isStudent(),
        chapters: CHAPTERS, currentChapter: cache.chapterCode || CHAPTERS[1],
        maxSubBytes: MAX_SUB_BYTES, allowedExt: ALLOWED_EXT,
        defaults: { sources: SOURCES, modules: MODULES, types: TYPES, severities: SEVERITIES, statuses: STATUSES },
      }
    },
    async tree() { return await buildTree() },
    async slides(args) { return await getSlides(args && args.chapter) },
    async pool(args) {
      if (args && typeof args.path === 'string' && args.path) {
        const doc = parseMarkdown(await readText(args.path))
        return {
          path: args.path, body: doc.body,
          sections: parseSections(doc.body).filter((s) => s.title !== THREAD_TITLE),
          thread: parseThread(doc.body),
          fields: {
            id: pad4(doc.fields.id), title: oneLine(doc.fields.title), source: oneLine(doc.fields.source),
            module: oneLine(doc.fields.module), lesson: oneLine(doc.fields.lesson), type: oneLine(doc.fields.type),
            severity: oneLine(doc.fields.severity), status: oneLine(doc.fields.status), ai: oneLine(doc.fields.ai),
            reporter: oneLine(doc.fields.reporter), owner: oneLine(doc.fields.owner),
          },
        }
      }
      return { generatedAt: new Date().toISOString(), items: await listItems() }
    },
    // 审计（设计原则.md 第 1/3 条）：老师判定一条学生提问的去向。
    //   shared  = 值得全班看到 → 导出进公开仓 FAQ（下次 publish 带出去）
    //   private = 只答提问人本人，不干扰其他学生
    async audit(args) {
      requireTeacher('审计学生提问')
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      const decision = input.decision === 'shared' ? 'shared' : (input.decision === 'private' ? 'private' : '')
      if (!p) throw new Error('缺少 path')
      if (!decision) throw new Error('decision 只能是 shared 或 private')
      const doc = parseMarkdown(await readText(p))
      doc.fields.updated = today()
      if (decision === 'shared') {
        doc.fields.status = '已沉淀'
        doc.fields.audit = 'shared'
      } else {
        doc.fields.status = '已答复'
        doc.fields.audit = 'private'
      }
      const sections = {}
      for (const s of parseSections(doc.body)) if (s.title !== THREAD_TITLE) sections[s.title] = s.content
      const parts = []
      for (const tt of SECTION_ORDER) if (sections[tt] !== undefined) parts.push(fold(tt, sections[tt]))
      await writeText(p, serialize(doc.fields, parts.join('\n') + '\n' + serializeThread(parseThread(doc.body))))
      return { ok: true, decision, status: doc.fields.status }
    },
    async docs(args) {
      if (args && typeof args.path === 'string' && args.path) {
        return { path: args.path, name: args.path.split('\\').pop(), text: await readText(args.path) }
      }
      return { docs: await listDocs() }
    },
    async ask(args) {
      const trace = ['插件版本 v24(固化)']
      const input = args && typeof args === 'object' ? args : {}
      const question = typeof input.question === 'string' ? input.question : ''
      const anchorText = typeof input.text === 'string' ? input.text : ''
      const origin = oneLine(input.origin) || '未标注来源'
      const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''
      let answer = ''
      let aiFailed = false
      let aiNote = ''
      try { answer = await askStudent(question, anchorText, dataUrl, trace, []) }
      catch (error) { aiFailed = true; aiNote = oneLine(error && error.message); answer = '（AI 暂未作答：' + aiNote + '）' }
      const answerText = typeof answer === 'string' ? answer : answer.answer
      const id = await nextId()
      const title = oneLine(question) || ('关于「' + origin.slice(0, 22) + '」的提问')
      const fields = {
        id, title: title.slice(0, 60), source: pickEnum(input.source, SOURCES, '阅读器框选图区'),
        module: pickEnum(input.module, MODULES, '模块一'), lesson: oneLine(input.lesson) || '未标注',
        type: pickEnum(input.type, TYPES, '概念问题'), severity: pickEnum(input.severity, SEVERITIES, '中'),
        status: '待处理', created: today(), updated: today(),
        reporter: '学生（阅读器提问）', owner: '', related_files: [origin], ai: aiFailed ? '失败' : '已作答', faq_id: '', linked_issue: '',
      }
      const rel = ITEMS_REL + '\\' + today() + '-' + id + '-' + safeName(title, id) + '.md'
      await writeText(rel, serialize(fields, composeBody(origin + '\n\n' + (anchorText ? ('> ' + anchorText.slice(0, 400)) : ''), answerText)))
      return { ok: true, id, path: rel, aiFailed, aiNote, trace }
    },
    async followup(args) {
      const trace = ['插件版本 v24(固化)']
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      const question = oneLine(input.question)
      if (!p) throw new Error('缺少 path')
      if (!question) throw new Error('缺少追问内容')
      const doc = parseMarkdown(await readText(p))
      const turns = parseThread(doc.body)
      if (turns.length >= MAX_THREAD_TURNS) throw new Error('追问轮次已达上限 ' + MAX_THREAD_TURNS)
      let answer = ''
      let aiFailed = false
      let aiNote = ''
      try { answer = await askStudent(question, sectionOf(doc.body, '原始提问', ''), '', trace, turns) }
      catch (error) { aiFailed = true; aiNote = oneLine(error && error.message); answer = '（AI 暂未作答：' + aiNote + '）' }
      turns.push({ q: question, a: answer })
      doc.fields.updated = today()
      await writeText(p, rebuildWithThread(doc, turns))
      return { ok: true, turns: turns.length, aiFailed, aiNote, trace }
    },
    async aianswer(args) {
      const trace = ['插件版本 v24(固化)']
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      if (!p) throw new Error('缺少 path')
      const doc = parseMarkdown(await readText(p))
      let answer = ''
      let aiFailed = false
      let aiNote = ''
      try { answer = await askStudent(sectionOf(doc.body, '原始提问', ''), '', '', trace, []) }
      catch (error) { aiFailed = true; aiNote = oneLine(error && error.message); answer = '（AI 暂未作答：' + aiNote + '）' }
      const sections = {}
      for (const s of parseSections(doc.body)) if (s.title !== THREAD_TITLE) sections[s.title] = s.content
      sections['AI 答复'] = answer
      const parts = []
      for (const t of SECTION_ORDER) if (sections[t] !== undefined) parts.push(fold(t, sections[t]))
      doc.fields.updated = today()
      doc.fields.ai = aiFailed ? '失败' : '已作答'
      await writeText(p, serialize(doc.fields, parts.join('\n') + '\n' + serializeThread(parseThread(doc.body))))
      return { ok: true, aiFailed, aiNote, trace }
    },
    async update(args) {
      requireTeacher('修改问题条目')
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      if (!p) throw new Error('缺少 path')
      const doc = parseMarkdown(await readText(p))
      const fields = doc.fields
      const patch = input.fields && typeof input.fields === 'object' ? input.fields : {}
      if (patch.status !== undefined) fields.status = pickEnum(patch.status, STATUSES, oneLine(fields.status) || '待处理')
      if (patch.severity !== undefined) fields.severity = pickEnum(patch.severity, SEVERITIES, oneLine(fields.severity))
      if (patch.type !== undefined) fields.type = pickEnum(patch.type, TYPES, oneLine(fields.type))
      if (patch.owner !== undefined) fields.owner = oneLine(patch.owner)
      if (patch.lesson !== undefined) fields.lesson = oneLine(patch.lesson)
      if (patch.module !== undefined) fields.module = pickEnum(patch.module, MODULES, oneLine(fields.module))
      fields.updated = today()
      let body = doc.body
      const secs = input.sections && typeof input.sections === 'object' ? input.sections : null
      if (secs) {
        const current = {}
        for (const s of parseSections(doc.body)) if (s.title !== THREAD_TITLE) current[s.title] = s.content
        for (const t of SECTION_ORDER) if (typeof secs[t] === 'string') current[t] = secs[t]
        const parts = []
        for (const t of SECTION_ORDER) if (current[t] !== undefined) parts.push(fold(t, current[t]))
        body = parts.join('\n') + '\n' + serializeThread(parseThread(doc.body))
      }
      await writeText(p, serialize(fields, body))
      return { ok: true, status: oneLine(fields.status) }
    },
    async 'submission.list'(args) {
      const input = args && typeof args === 'object' ? args : {}
      const lesson = parseInt(input.lesson, 10)
      if (!lesson) throw new Error('缺少课时号')
      const dir = subDirOf(lesson)
      const files = []
      for (const e of await listDir(dir)) {
        if (e.type !== 'file') continue
        files.push({ path: dir + '\\' + e.name, name: e.name, size: e.size || 0, graded: await exists(dir + '\\.graded\\' + e.name) })
      }
      files.sort((a, b) => a.name.localeCompare(b.name))
      return { dir, files }
    },
    async 'submission.save'(args) {
      const input = args && typeof args === 'object' ? args : {}
      const lesson = parseInt(input.lesson, 10)
      const nm = typeof input.name === 'string' ? input.name : ''
      const text = typeof input.text === 'string' ? input.text : ''
      if (!lesson) throw new Error('缺少课时号')
      if (!nm) throw new Error('缺少文件名')
      if (!extAllowed(nm)) throw new Error('不收这种文件类型：' + nm + '。只收文本类：' + ALLOWED_EXT.join(' '))
      if (text.length > MAX_SUB_BYTES) throw new Error('文件过大（上限 ' + Math.round(MAX_SUB_BYTES / 1024 / 1024 * 10) / 10 + 'MB）')
      const safe = nm.replace(/[\\/:*?"<>|]/g, '_')
      const rel = subDirOf(lesson) + '\\' + safe
      await writeText(rel, text)
      return { ok: true, rel, name: safe, bytes: text.length }
    },
    async 'submission.read'(args) {
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      if (!p) throw new Error('缺少 path')
      if (p.replace(/\\/g, '/').indexOf('作业提交/') < 0) throw new Error('只能读取作业提交目录')
      if (!extAllowed(p)) throw new Error('不收这种文件类型：' + p)
      return { path: p, name: p.split('\\').pop(), text: await readText(p) }
    },
    async 'submission.grade'(args) {
      requireTeacher('按教案批改')
      const trace = []
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      const lesson = parseInt(input.lesson, 10)
      if (!p) throw new Error('缺少 path')
      if (!lesson) throw new Error('缺少课时号')
      if (p.replace(/\\/g, '/').indexOf('作业提交/') < 0) throw new Error('只能批改作业提交目录里的文件')
      const code = await readText(p)
      trace.push('提交: ' + p.split('\\').pop() + '（' + code.length + ' 字符）')
      const plan = await planForLesson(lesson)
      if (plan.error) throw new Error(plan.error)
      trace.push('教案: ' + (plan.missing ? '未撰写（依据不完整）' : plan.rel))
      const idx = await loadIndex()
      const dims = (idx && idx.gradingDimensions) || []
      const dimText = dims.map((d, i) => (i + 1) + '. ' + d.name + '：' + d.desc).join('\n')
      const kp = await knowledgeOf(plan.mod ? plan.mod.dir : '', plan.lesson ? plan.lesson.plan : '')
      trace.push('知识点: ' + (kp.length ? kp.join(' / ') : '无'))
      const lines = [
        '【课时】' + lesson + '：' + (plan.lesson ? plan.lesson.title : '?'),
        '【所属】' + (plan.mod ? plan.mod.name + ' · ' + plan.mod.theme : '?'),
      ]
      if (kp.length) lines.push('【本课时知识点】' + kp.join(' / '))
      lines.push('')
      if (plan.missing) lines.push('【教案】本课时教案尚未撰写。请仅按课时标题与知识点做保守判断，并明确指出依据不足。')
      else lines.push('【教案全文】', '', plan.planText.slice(0, 6000))
      lines.push('', '【批改维度】', dimText)
      lines.push('', '【学生提交的代码】', '```', code.slice(0, 8000), '```')
      lines.push('', '请按以下格式输出（Markdown）：')
      lines.push('1. 一句话结论（是否达到本课时的验收标准）')
      lines.push('2. 逐条对照教案《验收标准》：每条写 通过/不通过/无法判断 + 具体证据（行号或片段）')
      lines.push('3. 按批改维度逐项评述（不要打分）')
      lines.push('4. 与教案要求的偏离之处（重点：教案要求学生自己实现、而学生直接用库绕过的地方）')
      lines.push('5. 建议学生自己重做的点（最多 3 条）')
      lines.push('6. 需要教师人工确认的问题（如果有）')
      let feedback = ''
      let aiNote = ''
      try { feedback = await callModel(GRADER_SYSTEM, [msg('user', lines.join('\n'))], trace) }
      catch (error) { aiNote = oneLine(error && error.message); feedback = '（AI 批改失败：' + aiNote + '）' }
      if (!aiNote) {
        try { await writeText(subDirOf(lesson) + '\\.graded\\' + p.split('\\').pop(), today() + ' 已批改\n') }
        catch (e) { trace.push('标记已批改失败: ' + oneLine(e && e.message)) }
      }
      return { ok: true, feedback, aiFailed: !!aiNote, aiNote, planMissing: !!plan.missing, trace }
    },
  }

  // ── 静态路由 ──
  // mediaOk 必须在「路由注册成功」时就置 true，不能等到第一次成功读图再置。
  // 否则第一次取课件时 mediaOk 仍为 false，getSlides() 会把所有 m.file 清成 null，
  // 整个面板就全是「图片不可用」——先有鸡还是先有蛋的坑。
  cache.mediaOk = ctx.webServer !== undefined
  if (!cache.mediaOk) cache.mediaError = 'webServer 不可用'

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: MEDIA_PREFIX,
    handler: async (req, res) => {
      let nm = ''
      try {
        let rel = String(req.url || '')
        if (rel.indexOf(MEDIA_PREFIX) === 0) rel = rel.slice(MEDIA_PREFIX.length)
        if (rel[0] === '/') rel = rel.slice(1)
        const qi = rel.indexOf('?'); if (qi >= 0) rel = rel.slice(0, qi)
        nm = decodeURIComponent(rel)
      } catch (e) { nm = '' }
      nm = nm.replace(/\\/g, '/')
      const segs = nm.split('/')
      if (!nm || nm.indexOf('..') >= 0 || segs.length !== 2 || CHAPTERS.indexOf(segs[0]) < 0 || !segs[1]) {
        res.statusCode = 400; res.end('bad name'); return
      }
      try {
        const dirRel = MEDIA_DIR_REL + '\\' + segs[0]
        const dirAbs = absOf(dirRel)
        let useName = segs[1]
        let full = path.join(dirAbs, useName)
        if (!fs.existsSync(full)) {
          // ── 扩展名回退 ──
          // 课件 JSON 是在老师机上抽取时生成的，里面写死的是**原始**扩展名（.png/.jpeg/.gif）。
          // 学生端发的是转码后的 .webp（见 课程发布/tools/to_webp.py，体积约为原来的 30%）。
          // 两边扩展名必然对不上，所以这里做一次等价名查找。
          // 关键点：这只改「读哪个文件」，不改 JSON、不改客户端 —— 客户端拿到的仍是它要的那个 URL。
          const stem = useName.replace(/\.[^.]+$/, '')
          const alt = ['.webp', '.png', '.jpg', '.jpeg', '.gif'].map((x) => stem + x)
          const hit = alt.find((x) => fs.existsSync(path.join(dirAbs, x)))
          if (hit) { useName = hit; full = path.join(dirAbs, hit) }
          else if (/\.(mp4|mov|webm|avi|m4v)$/i.test(useName)) {
            // 视频是有意不随课程包分发的（单个 mp4 可达 34 MB，且本来就是 PPT 内嵌的录屏片段）。
            // 返回一张说明牌，让面板显示「这段视频不在课程包里」，比一个破图有用得多。
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180">'
              + '<rect width="640" height="180" fill="#f4f4f5" stroke="#d4d4d8"/>'
              + '<text x="320" y="80" text-anchor="middle" font-size="17" fill="#52525b" font-family="sans-serif">此视频未随课程包分发</text>'
              + '<text x="320" y="112" text-anchor="middle" font-size="13" fill="#71717a" font-family="sans-serif">' + oneLine(useName).replace(/[<&>]/g, '') + '</text>'
              + '<text x="320" y="140" text-anchor="middle" font-size="12" fill="#a1a1aa" font-family="sans-serif">原始 PPT 内嵌的录屏片段，体积过大；需要请看课程录制</text>'
              + '</svg>'
            res.statusCode = 200
            res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
            res.setHeader('Cache-Control', 'public, max-age=86400')
            res.end(svg)
            return
          }
        }
        const bytes = await fsMod.readBytes(await fsMod.resolve(full, { cwd: WORKSPACE }), undefined, MEDIA_MAX_BYTES)
        cache.mediaOk = true
        res.statusCode = 200
        res.setHeader('Content-Type', /\.png$/i.test(useName) ? 'image/png' : (/\.jpe?g$/i.test(useName) ? 'image/jpeg' : (/\.gif$/i.test(useName) ? 'image/gif' : (/\.webp$/i.test(useName) ? 'image/webp' : (/\.svg$/i.test(useName) ? 'image/svg+xml' : 'application/octet-stream')))))
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.end(bytes)
      } catch (error) {
        // 读失败要可见：原因留在 info 里，不要静默 404
        cache.mediaError = '读图失败 ' + oneLine(segs[0] + '/' + segs[1]) + '：' + oneLine(error && error.message)
        console.error('[course-panel media] ' + cache.mediaError)
        res.statusCode = 404; res.end('not found')
      }
    },
  }), 'course-panel media')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: KATEX_PREFIX,
    handler: async (req, res) => {
      let nm = ''
      try {
        let rel = String(req.url || '')
        if (rel.indexOf(KATEX_PREFIX) === 0) rel = rel.slice(KATEX_PREFIX.length)
        if (rel[0] === '/') rel = rel.slice(1)
        const qi = rel.indexOf('?'); if (qi >= 0) rel = rel.slice(0, qi)
        nm = decodeURIComponent(rel)
      } catch (e) { nm = '' }
      const allow = { 'katex.min.js': 'application/javascript; charset=utf-8', 'katex.min.css': 'text/css; charset=utf-8' }
      if (!Object.prototype.hasOwnProperty.call(allow, nm)) { res.statusCode = 404; res.end('not found'); return }
      // 只从这里读：它的取值要么是包内自带目录，要么是 CIP_KATEX_DIR 指定的目录，
      // 两者都不受「profile 里恰好有没有 katex」影响。
      const full = path.join(KATEX_DIR, nm)
      if (path.dirname(path.resolve(full)) !== path.resolve(KATEX_DIR)) { res.statusCode = 404; res.end('not found'); return }
      try {
        const bytes = fs.readFileSync(full)
        res.statusCode = 200
        res.setHeader('Content-Type', allow[nm])
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.end(bytes)
      } catch (error) { console.error('[cip-katex] ' + oneLine(error && error.message)); res.statusCode = 404; res.end('not found') }
    },
  }), 'course-panel katex')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: CSS_PATH,
    handler: async (req, res) => {
      // 先试工作区里的源文件（老师改样式用），失败就用包内自带的副本（学生走这条）
      const tried = []
      for (const p of [absOf(PANEL_CSS_REL), BUNDLED_CSS]) {
        try {
          const bytes = fs.readFileSync(p)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/css; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(bytes)
          return
        } catch (e) { tried.push(p) }
      }
      console.error('[cip-css] 两处都没有样式表: ' + tried.join(' | '))
      res.statusCode = 404; res.end('not found')
    },
  }), 'course-panel css')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: API_PREFIX,
    handler: async (req, res) => {
      let action = ''
      try {
        let rel = String(req.url || '')
        if (rel.indexOf(API_PREFIX) === 0) rel = rel.slice(API_PREFIX.length)
        if (rel[0] === '/') rel = rel.slice(1)
        const qi = rel.indexOf('?'); if (qi >= 0) rel = rel.slice(0, qi)
        action = decodeURIComponent(rel)
      } catch (e) { action = '' }
      const fn = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null
      if (!fn) { sendJson(res, { error: 'unknown action: ' + action, available: Object.keys(handlers) }, 404); return }
      let args = {}
      if (String(req.method).toUpperCase() === 'POST') args = await readBody(req)
      else {
        try {
          const u = new URL(String(req.url || ''), 'http://localhost')
          u.searchParams.forEach((v, k) => { args[k] = v })
        } catch (e) { /* 保持空对象 */ }
      }
      try { sendJson(res, await fn(args)) }
      catch (error) { sendJson(res, { error: oneLine(error && error.message) }, 500) }
    },
  }), 'course-panel api')

  console.log('[course-panel] 宿主半区就绪（v0.3.0）角色=' + ROLE + ' 工作区: ' + WORKSPACE + '（' + WS.how + '）')
  if (!fs.existsSync(path.join(WORKSPACE, '课程中心'))) {
    console.warn('[course-panel] ⚠ 工作区里没有「课程中心」目录，面板会是空的。试过：')
    for (const t of WS.tried) console.warn('[course-panel]   ' + t)
    console.warn('[course-panel] 学生端请用 install.ps1 安装（它会写好工作区路径），或设 CIP_WORKSPACE')
  }
  if (!fs.existsSync(path.join(KATEX_DIR, 'katex.min.js'))) {
    console.warn('[course-panel] ⚠ 找不到 katex（' + KATEX_DIR + '），公式将无法渲染')
  }
}
