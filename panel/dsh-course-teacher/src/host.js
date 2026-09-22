/**
 * dsh-course-teacher —— 教师端课程面板（宿主半区）
 *
 * 与学生端是两个独立插件：前缀不同、侧栏入口不同、能同时装。
 * 教师端在学生端之上多出四件事：
 *   1. 看到**全部**学生的提问与提交（学生端只能看到自己的 + 已公开的）
 *   2. 审计：把一条学生提问判成「值得共享」或「只答本人」
 *   3. 汇总共性问题：同一个问题被多个学生踩到，才值得沉淀
 *   4. 归档与发布：把策展结果写进公共面，交给 git 同步出去
 *
 * 教师端自身不调用模型（不花额度），只做整理与判断 —— 这与
 * 「费用由学生承担、教师负责策展」的设计一致。
 */
import { loadCore, PLUGIN_ROOT } from './core-loader.js'

export const name = 'course-panel-teacher'
export const inject = ['webServer']

const PREFIX = process.env.CIP_TEA_PREFIX || '/cip-tea'
const LABEL = '课程面板·教师端'
const COURSE_CODE = process.env.CIP_COURSE_CODE || ''

export async function apply(ctx) {
  const C = await loadCore()
  const core = C.createCore(ctx, { prefix: PREFIX, role: 'teacher', pkgRoot: PLUGIN_ROOT, label: LABEL })
  core.warn()

  const {
    oneLine, today, safeId,
    PUBLIC_ITEMS_REL, STUDENT_ITEMS_REL,
  } = C

  const TEACHER = safeId(process.env.CIP_TEACHER || process.env.USERNAME || 'teacher') || 'teacher'

  /** 归一化问题文本，用来判断「是不是同一个问题」 */
  function fingerprint(s) {
    return oneLine(s)
      .replace(/[\s，。、；：（）()【】\[\]「」《》"'`]/g, '')
      .replace(/^(为什么|为何|请问|如何|怎么|什么是)/, '')
      .toLowerCase()
      .slice(0, 40)
  }

  /** 从一条条目的正文/线程里取出「问题文本」，用于聚合 */
  function problemTextOf(it) {
    if (it.title) return it.title
    return ''
  }

  const handlers = {
    async info() {
      const items = await core.listItems()
      const byScope = { public: 0, student: 0, legacy: 0 }
      const students = new Set()
      for (const i of items) {
        byScope[i.scope] = (byScope[i.scope] || 0) + 1
        if (i.student) students.add(i.student)
      }
      const subs = core.listSubmissions()
      const subStudents = new Set(subs.map((s) => s.student).filter(Boolean))
      return Object.assign(core.info(), {
        teacher: TEACHER, courseCode: COURSE_CODE,
        counts: {
          items: items.length, byScope,
          students: students.size, submissions: subs.length, submitStudents: subStudents.size,
        },
        publicDir: PUBLIC_ITEMS_REL, studentDir: STUDENT_ITEMS_REL,
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

    /** 全部条目（教师视角：不做可见性裁剪） */
    async threads(args) {
      const input = args && typeof args === 'object' ? args : {}
      let items = await core.listItems()
      if (input.student) items = items.filter((i) => i.student === input.student)
      if (input.scope) items = items.filter((i) => i.scope === input.scope)
      if (input.lesson) items = items.filter((i) => String(i.lesson) === String(input.lesson))
      const students = [...new Set((await core.listItems()).map((i) => i.student).filter(Boolean))].sort()
      return { teacher: TEACHER, items, students, publicDir: PUBLIC_ITEMS_REL }
    },
    async thread(args) {
      const p = args && typeof args.path === 'string' ? args.path : ''
      if (!p || !core.exists(p)) throw new Error('条目不存在：' + p)
      const it = core.readItem(p)
      return { path: p, fields: it.fields, body: it.body, turns: it.turns }
    },

    /**
     * 审计：一条学生提问的去向。
     *   shared  → 进公共面（写进 课程问题池/公共/），下次发布带给全班
     *   private → 留在该学生的私有目录里，只答本人
     * 老师可以顺手改标题与总结 —— 这是「统一风格」的最后一关：
     * 模型凝练过一次，但老师有权覆盖，公共池的措辞由老师负责。
     */
    async audit(args) {
      const input = args && typeof args === 'object' ? args : {}
      const p = typeof input.path === 'string' ? input.path : ''
      const decision = input.decision === 'shared' ? 'shared' : (input.decision === 'private' ? 'private' : '')
      if (!p || !core.exists(p)) throw new Error('条目不存在')
      if (!decision) throw new Error('decision 只能是 shared 或 private')

      const it = core.readItem(p)
      const sections = core.sectionsOf(it.body)
      it.fields.updated = today()
      it.fields.audit = decision
      if (typeof input.title === 'string' && oneLine(input.title)) it.fields.title = oneLine(input.title).slice(0, 60)
      if (typeof input.summary === 'string' && oneLine(input.summary)) it.fields.summary = oneLine(input.summary).slice(0, 300)
      if (typeof input.note === 'string' && oneLine(input.note)) sections['教师归档'] = oneLine(input.note)

      if (decision === 'shared') {
        it.fields.status = '已沉淀'
        // 复制进公共面：原条留在学生私有目录（学生那边仍看得到自己的），公共面是策展副本。
        // 两份而不是移动 —— 移动会让学生的历史记录突然消失。
        const pubRel = PUBLIC_ITEMS_REL + '\\' + p.split('\\').pop()
        core.writeItem(pubRel, Object.assign({}, it.fields, { audit: 'shared', status: '已沉淀' }), sections, it.turns)
        core.writeItem(p, it.fields, sections, it.turns)
        return { ok: true, decision, status: it.fields.status, publicPath: pubRel }
      }
      it.fields.status = '已答复'
      core.writeItem(p, it.fields, sections, it.turns)
      // 曾经公开过又要撤回：把公共面那份删掉，否则学生还能看到
      const pubRel = PUBLIC_ITEMS_REL + '\\' + p.split('\\').pop()
      let removed = false
      if (core.exists(pubRel)) { try { (await import('node:fs')).unlinkSync(core.abs(pubRel)); removed = true } catch (e) { /* 忽略 */ } }
      return { ok: true, decision, status: it.fields.status, removedFromPublic: removed }
    },

    /**
     * 共性问题汇总。
     * 判据不是「有几条」，而是「有几个**不同学生**踩到」——
     * 一个学生反复问同一个东西，那是他自己的困惑；三个学生各问一次，
     * 那才是教案或讲法的问题，值得沉淀。
     */
    async common(args) {
      const input = args && typeof args === 'object' ? args : {}
      const items = await core.listItems()
      const groups = new Map()
      for (const it of items) {
        const key = (it.lesson || '未标注') + '||' + fingerprint(problemTextOf(it))
        if (!groups.has(key)) {
          groups.set(key, { lesson: it.lesson || '未标注', module: it.module || '', type: it.type || '', sample: problemTextOf(it), students: new Set(), items: [], maxSeverity: '' })
        }
        const g = groups.get(key)
        if (it.student) g.students.add(it.student)
        g.items.push(it)
        const rank = { '阻塞': 4, '高': 3, '中': 2, '低': 1 }
        if ((rank[it.severity] || 0) > (rank[g.maxSeverity] || 0)) g.maxSeverity = it.severity
      }
      const out = []
      for (const g of groups.values()) {
        const shared = g.items.some((i) => i.audit === 'shared')
        out.push({
          lesson: g.lesson, module: g.module, type: g.type, sample: g.sample,
          students: [...g.students], studentCount: g.students.size,
          count: g.items.length, maxSeverity: g.maxSeverity, alreadyShared: shared,
          paths: g.items.map((i) => i.path),
        })
      }
      // 排序：多个学生踩到 > 严重度 > 条数
      out.sort((a, b) => (b.studentCount - a.studentCount)
        || (({ '阻塞': 4, '高': 3, '中': 2, '低': 1 }[b.maxSeverity] || 0) - ({ '阻塞': 4, '高': 3, '中': 2, '低': 1 }[a.maxSeverity] || 0))
        || (b.count - a.count))
      const minStudents = Number(input.minStudents) > 0 ? Number(input.minStudents) : 2
      return { groups: out, common: out.filter((g) => g.studentCount >= minStudents), minStudents }
    },

    /** 把一条共性问题批量标为共享（老师点「这批都值得共享」时用） */
    async 'audit.batch'(args) {
      const input = args && typeof args === 'object' ? args : {}
      const paths = Array.isArray(input.paths) ? input.paths : []
      const decision = input.decision === 'private' ? 'private' : 'shared'
      const out = []
      for (const p of paths) {
        try {
          const r = await handlers.audit({ path: p, decision, note: input.note })
          out.push({ path: p, ok: true, publicPath: r.publicPath })
        } catch (e) { out.push({ path: p, ok: false, error: oneLine(e && e.message) }) }
      }
      return { ok: true, done: out.filter((x) => x.ok).length, results: out }
    },

    /** 待发布清单：公共面里有什么，将会被 publish 带进公开仓 */
    async staged() {
      const pubDir = core.abs(PUBLIC_ITEMS_REL)
      const fs = await import('node:fs')
      let files = []
      try { files = fs.readdirSync(pubDir).filter((n) => /\.md$/i.test(n)) } catch (e) { files = [] }
      const subs = core.listSubmissions()
      return {
        publicDir: PUBLIC_ITEMS_REL, files,
        submissions: subs,
        workspace: core.WORKSPACE,
        note: '把公共面 + 教案发到公开仓：在课程发布目录执行 node course-repo.mjs publish，然后 git push',
      }
    },

    /** 学生提交（教师视角：全部学生） */
    async submissions(args) {
      const input = args && typeof args === 'object' ? args : {}
      let files = core.listSubmissions()
      if (input.student) files = files.filter((s) => s.student === input.student)
      if (input.lesson) files = files.filter((s) => s.name.indexOf(input.lesson) >= 0)
      const students = [...new Set(core.listSubmissions().map((s) => s.student).filter(Boolean))].sort()
      return { files, students }
    },
    async 'submission.read'(args) {
      const p = args && typeof args.path === 'string' ? args.path : ''
      if (!p || !core.exists(p)) throw new Error('提交不存在')
      const text = core.readText(p)
      return { path: p, name: p.split('\\').pop(), text, bytes: Buffer.byteLength(text, 'utf8') }
    },

    /**
     * 课堂记录汇总：把一次课的提问按课时与类型排成一个可读列表，
     * 用于课后归档。老师可以据此改教案或写答疑课提纲。
     */
    async digest(args) {
      const input = args && typeof args === 'object' ? args : {}
      const items = await core.listItems()
      const byLesson = new Map()
      for (const it of items) {
        const k = it.lesson || '未标注'
        if (!byLesson.has(k)) byLesson.set(k, [])
        byLesson.get(k).push(it)
      }
      const out = []
      for (const [lesson, list] of byLesson) {
        out.push({
          lesson,
          total: list.length,
          byType: list.reduce((a, i) => { a[i.type || '未分类'] = (a[i.type || '未分类'] || 0) + 1; return a }, {}),
          bySeverity: list.reduce((a, i) => { a[i.severity || '未标注'] = (a[i.severity || '未标注'] || 0) + 1; return a }, {}),
          students: [...new Set(list.map((i) => i.student).filter(Boolean))].length,
          shared: list.filter((i) => i.audit === 'shared').length,
          titles: list.slice(0, 40).map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, student: i.student })),
        })
      }
      out.sort((a, b) => b.total - a.total)
      return { generatedAt: new Date().toISOString(), teacher: TEACHER, lessons: out, courseCode: COURSE_CODE, want: input.lesson || null }
    },
  }

  core.registerApi(handlers)
  core.mount()
  console.log('[' + LABEL + '] 就绪 v0.1.0 · 教师=' + TEACHER + ' · 工作区=' + core.WORKSPACE + '（' + core.WS.how + '）· 前缀 ' + PREFIX)
}

export default { name, inject, apply }
