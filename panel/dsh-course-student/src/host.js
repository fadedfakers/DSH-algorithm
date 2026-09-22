/**
 * dsh-course-student —— 学生端课程面板（宿主半区）
 *
 * 与教师端是**两个独立插件**：各自的路由前缀、各自的侧栏入口，可以装在同一个
 * DSH 进程里。DSH 的 webServer 对重复的 (kind, path) 会抛错，所以前缀必须不同 ——
 * 这不是偏好，是硬约束。
 *
 * 这个半区负责「花钱的那一侧」：
 *   · 提问与每一轮追问都调用模型（老师的原话：隐性提问，费用学生自己承担）
 *   · 作业按教案批改也调用模型
 * 因此每次调用都把 token 用量记进条目，面板里能看见自己花了多少。
 */
import { loadCore, PLUGIN_ROOT } from './core-loader.js'

export const name = 'course-panel-student'
export const inject = ['webServer']

const PREFIX = process.env.CIP_STU_PREFIX || '/cip-stu'
const LABEL = '课程面板·学生端'

export async function apply(ctx) {
  const C = await loadCore()
  const core = C.createCore(ctx, { prefix: PREFIX, role: 'student', pkgRoot: PLUGIN_ROOT, label: LABEL })
  core.warn()

  const {
    oneLine, today, safeId, pad4, extAllowed, pickEnum, parseIssueList, ALLOWED_EXT,
    MODULES, TYPES, SEVERITIES, SOURCES, MAX_SUB_BYTES, MAX_THREAD_TURNS,
    runTurn, makeTitle, makeSummary, runGrade,
    PUBLIC_ITEMS_REL, STUDENT_ITEMS_REL,
  } = C

  /** 学生身份：用于把提问/作业归到自己名下。没设就退到系统用户名。 */
  const STUDENT = safeId(process.env.CIP_STUDENT || process.env.USERNAME || process.env.USER || 'anonymous') || 'anonymous'
  const MY_DIR = STUDENT_ITEMS_REL + '\\' + STUDENT

  function acc(a, b) {
    return {
      inputTokens: Number(a.inputTokens || 0) + Number(b && b.inputTokens || 0),
      outputTokens: Number(a.outputTokens || 0) + Number(b && b.outputTokens || 0),
    }
  }
  function usageField(u) {
    const s = 'in ' + Number(u.inputTokens || 0) + ' / out ' + Number(u.outputTokens || 0)
    return s
  }

  /** 建一条新条目（落在我自己的私有目录里） */
  async function createItem(fields, sections, turns) {
    const rel = core.itemRelFor(fields, fields.title, 'student', STUDENT)
    core.writeItem(rel, fields, sections, turns || [])
    return rel
  }

  // ── 数据面 ──────────────────────────────────────────────────
  const handlers = {
    async info() {
      const items = await core.listItems()
      const mine = items.filter((i) => i.student === STUDENT || i.scope === 'legacy')
      const pub = items.filter((i) => i.scope === 'public')
      return Object.assign(core.info(), {
        student: STUDENT, myDir: MY_DIR,
        counts: { mine: mine.length, public: pub.length, total: items.length },
      })
    },
    async tree() { return { tree: await core.getTree() } },
    async slides(args) { return (await core.getSlides(args && args.chapter)) || { error: '该章课件数据不存在' } },
    async docs(args) {
      if (args && typeof args.path === 'string' && args.path) {
        return { path: args.path, name: args.path.split('\\').pop(), text: core.readText(args.path) }
      }
      return { docs: await core.listDocs() }
    },

    /** 问题列表：只有「我自己的」+「老师策展后公开的」，看不到别的同学的 */
    async threads() {
      const all = await core.listItems()
      const mine = all.filter((i) => i.scope === 'legacy' || (i.scope === 'student' && i.student === STUDENT))
      const pub = all.filter((i) => i.scope === 'public')
      return { student: STUDENT, mine, public: pub, myDir: MY_DIR, publicDir: PUBLIC_ITEMS_REL }
    },
    /** 读一条：md 全文 + 结构化线程 */
    async thread(args) {
      const p = args && typeof args.path === 'string' ? args.path : ''
      if (!p || !core.exists(p)) throw new Error('条目不存在：' + p)
      // 学生只能读自己的和已公开的，别的同学的私有条目不给读
      const scope = p.indexOf(PUBLIC_ITEMS_REL) === 0 ? 'public'
        : (p.indexOf(STUDENT_ITEMS_REL) === 0 ? 'student' : 'legacy')
      if (scope === 'student' && p.indexOf('\\' + STUDENT + '\\') < 0) throw new Error('这条提问不属于你')
      const it = core.readItem(p)
      return { path: p, fields: it.fields, body: it.body, turns: it.turns, scope }
    },

    /**
     * 提问：模型凝练标题 → AI 作答 → 归档。
     * 标题先凝练再落盘，这样文件名和列表里的标题从第一刻起就是统一风格的。
     */
    async ask(args) {
      const trace = []
      const input = args && typeof args === 'object' ? args : {}
      const question = oneLine(input.question)
      if (!question) throw new Error('缺少提问内容')
      const anchorText = typeof input.text === 'string' ? input.text : ''
      const origin = oneLine(input.origin) || '未标注来源'
      const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''

      let usage = { inputTokens: 0, outputTokens: 0 }
      let title = ''
      let summary = ''
      let answer = ''
      let aiFailed = false
      let aiNote = ''

      const t = await makeTitle(ctx, { question, anchorText, trace })
      title = t.title; usage = acc(usage, t.usage)

      try {
        const r = await runTurn(ctx, { question, anchorText, dataUrl, history: [], trace })
        answer = r.answer; usage = acc(usage, r.usage)
      } catch (error) { aiFailed = true; aiNote = oneLine(error && error.message); answer = '（AI 暂未作答：' + aiNote + '）' }

      const s = await makeSummary(ctx, { question, answer, thread: [], trace })
      summary = s.summary; usage = acc(usage, s.usage)

      const id = await core.nextId()
      const fields = {
        id, title, summary,
        source: pickEnum(input.source, SOURCES, '阅读器框选图区'),
        module: pickEnum(input.module, MODULES, '模块一'),
        lesson: oneLine(input.lesson) || '未标注',
        type: pickEnum(input.type, TYPES, '概念问题'),
        severity: pickEnum(input.severity, SEVERITIES, '中'),
        status: '待处理', created: today(), updated: today(),
        reporter: '学生（' + STUDENT + '）', student: STUDENT,
        related_files: [origin], ai: aiFailed ? '失败' : '已作答',
        tokens: usageField(usage),
      }
      const sections = {
        '原始提问': origin + '\n\n' + question + (anchorText ? ('\n\n> ' + anchorText.slice(0, 1200)) : ''),
        'AI 答复': answer,
      }
      const rel = await createItem(fields, sections, [])
      return { ok: true, id, path: rel, title, summary, answer, aiFailed, aiNote, usage, trace }
    },

    /**
     * 追问：**每一轮都真的调模型作答**，没有「同上」。
     * 线程满 MAX_THREAD_TURNS 轮后会拒绝，避免一次提问无限烧 token。
     */
    async followup(args) {
      const trace = []
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      const question = oneLine(input.question)
      if (!p || !core.exists(p)) throw new Error('条目不存在')
      if (p.indexOf('\\' + STUDENT + '\\') < 0 && p.indexOf(STUDENT_ITEMS_REL) !== 0) {
        // 允许对自己目录下的条目追问；公开的别人条目不给追加
        if (core.exists(p) && p.indexOf(PUBLIC_ITEMS_REL) === 0) throw new Error('这是已公开的提问，不能改动；请新建你自己的提问')
      }
      if (!question) throw new Error('缺少追问内容')

      const it = core.readItem(p)
      const turns = it.turns
      if (turns.length >= MAX_THREAD_TURNS) throw new Error('追问轮次已达上限 ' + MAX_THREAD_TURNS + ' 轮（防误触烧额度）')
      const sections = core.sectionsOf(it.body)
      const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''

      let answer = ''
      let aiFailed = false
      let aiNote = ''
      let usage = { inputTokens: 0, outputTokens: 0 }
      try {
        const r = await runTurn(ctx, {
          question, anchorText: typeof input.text === 'string' ? input.text : '',
          dataUrl, history: turns, trace,
        })
        answer = r.answer; usage = acc(usage, r.usage)
      } catch (error) { aiFailed = true; aiNote = oneLine(error && error.message); answer = '（AI 暂未作答：' + aiNote + '）' }
      turns.push({ q: question, a: answer, at: new Date().toISOString() })

      // 追加 AI 答复小节：让它和首答一起成为「完整问答」
      sections['AI 答复'] = (sections['AI 答复'] || '') + '\n\n---\n\n**追问：** ' + question + '\n\n' + answer
      // 轮次变多后重做一次问题总结，让它反映全部讨论（而不是只有第一轮）
      const s = await makeSummary(ctx, { question: sections['原始提问'] || it.fields.title, answer: sections['AI 答复'], thread: turns, trace })
      if (s.summary) { it.fields.summary = s.summary; usage = acc(usage, s.usage) }

      const prev = it.fields.tokens || ''
      const prevIn = Number((/in (\d+)/.exec(prev) || [])[1] || 0)
      const prevOut = Number((/out (\d+)/.exec(prev) || [])[1] || 0)
      it.fields.tokens = 'in ' + (prevIn + usage.inputTokens) + ' / out ' + (prevOut + usage.outputTokens)
      it.fields.updated = today()
      core.writeItem(p, it.fields, sections, turns)
      return { ok: true, turns: turns.length, answer, summary: it.fields.summary, aiFailed, aiNote, usage, trace }
    },

    /** 我的额度消耗：把条目里记的 token 累加起来，让学生看得见 */
    async usage() {
      const all = await core.listItems()
      const mine = all.filter((i) => i.scope === 'legacy' || (i.scope === 'student' && i.student === STUDENT))
      let tin = 0; let tout = 0
      const per = mine.map((i) => {
        const a = Number((/in (\d+)/.exec(i.tokens || '') || [])[1] || 0)
        const b = Number((/out (\d+)/.exec(i.tokens || '') || [])[1] || 0)
        tin += a; tout += b
        return { id: i.id, title: i.title, lesson: i.lesson, tokens: i.tokens, turns: i.turns }
      })
      return { student: STUDENT, inputTokens: tin, outputTokens: tout, items: per.length, per }
    },

    // ── 作业批改（模型费用由学生承担）──────────────────────────
    async 'submission.list'(args) {
      const lesson = oneLine(args && args.lesson)
      const all = core.listSubmissions()
      const mine = all.filter((s) => s.student === STUDENT)
      return { student: STUDENT, files: mine, lesson, dir: core.submitDirOf(STUDENT) }
    },
    async 'submission.save'(args) {
      const input = args && typeof args === 'object' ? args : {}
      const name = String(input.name || '').replace(/[\\/:*?"<>|]/g, '_')
      const text = String(input.text || '')
      if (!name) throw new Error('缺少文件名')
      if (!extAllowed(name)) throw new Error('不允许的文件类型：' + name + '（允许 ' + ALLOWED_EXT + '）')
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > MAX_SUB_BYTES) throw new Error('文件太大：' + bytes + ' 字节（上限 ' + MAX_SUB_BYTES + '）')
      const lesson = oneLine(input.lesson) || '未标注课时'
      const rel = core.submitDirOf(STUDENT) + '\\' + lesson + '__' + name
      core.writeText(rel, text)
      return { ok: true, rel, bytes }
    },
    async 'submission.read'(args) {
      const p = args && typeof args.path === 'string' ? args.path : ''
      if (!p || !core.exists(p)) throw new Error('提交不存在')
      const text = core.readText(p)
      return { path: p, name: p.split('\\').pop(), text, bytes: Buffer.byteLength(text, 'utf8') }
    },
    /**
     * 按教案批改。教案是**对齐基准**：教案要求手写实现，学生调库绕过，
     * 就必须指出来 —— 这正是老师说的「避免训练的侧重点偏移」。
     * 判出来的问题同时写进学生自己的私有条目，供之后汇总。
     */
    async 'submission.grade'(args) {
      const trace = []
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      const lessonNo = Number(input.lesson) || 0
      if (!p || !core.exists(p)) throw new Error('提交不存在')
      const code = core.readText(p)
      const planRel = await core.planPathFor(lessonNo)
      const plan = planRel ? core.readText(planRel) : ''
      trace.push(planRel ? ('教案: ' + planRel) : '未找到该课时教案（只能做通用初筛）')
      const tree = await core.getTree()
      const dims = (tree && tree.gradingDimensions) || []
      const r = await runGrade(ctx, { plan, code, dimensions: dims, lesson: '课时' + lessonNo, trace })
      const issues = parseIssueList(r.text)

      // 把问题清单逐条落成私有条目，教师端之后按课时汇总
      const saved = []
      if (issues.length) {
        const base = await core.nextId()
        for (let i = 0; i < issues.length; i += 1) {
          const f = {
            id: pad4(Number(base) + i), title: issues[i].text.slice(0, 60),
            summary: '来自课时 ' + lessonNo + ' 的作业批改：' + issues[i].text,
            source: '作业', module: pickEnum(input.module, MODULES, '模块一'),
            lesson: '课时' + lessonNo, type: '作业疑问', severity: issues[i].severity,
            status: '待处理', created: today(), updated: today(),
            reporter: '学生（' + STUDENT + '）', student: STUDENT,
            related_files: [p], ai: '已作答', tokens: usageField(r.usage),
          }
          const rel = await createItem(f, {
            '原始提问': '课时 ' + lessonNo + ' 作业：' + issues[i].text + '\n\n提交文件：' + p,
            '现象': '该问题由 AI 按教案初筛得出，证据见批改正文。',
            '初步判断': issues[i].text,
            'AI 答复': '（见批改正文）',
          }, [])
          saved.push({ path: rel, severity: issues[i].severity, text: issues[i].text })
        }
      }
      return { ok: true, path: p, lesson: lessonNo, planRel, text: r.text, issues: saved, usage: r.usage, trace }
    },
  }

  core.registerApi(handlers)
  core.mount()
  console.log('[' + LABEL + '] 就绪 v0.1.0 · 学生=' + STUDENT + ' · 工作区=' + core.WORKSPACE + '（' + core.WS.how + '）· 前缀 ' + PREFIX)
}

export default { name, inject, apply }
