/**
 * dsh-course-teacher —— 教师端客户端半区
 *
 * 教师端的职责是「整理与判断」，不是「花钱」：
 *   · 看全部学生的提问与提交（学生端只看得到自己的 + 已公开的）
 *   · 审计：值得共享 → 进公共池；只答本人 → 留在该学生私有目录
 *   · 共性问题汇总：判据是**几个不同学生**踩到，不是一个人问了几次
 *   · 归档与待发布：公共面里有什么，publish 会带进公开仓
 *
 * 这一侧不调用模型 —— 所以界面上没有「AI 作答中」这类状态。
 */
window.__ModuleLoader__.load({
  id: 'dsh-course-teacher',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    const PANEL_ID = 'course-teacher'
    const API = '/cip-tea-api'
    const MEDIA = '/cip-tea-media'

    globalThis.__CIP_UI_CFG__ = {
      katex: '/cip-tea-katex', css: '/cip-tea.css', cssId: 'cip-tea-css', media: MEDIA,
    }
    const ui = require('dsh-course-client-core')
    const {
      ensureCss, css, h, bdg, Markdown, loadKatex, Fishbone, MediaImage,
      STATUS_COLOR, SEVERITY_COLOR, ZOOM_MIN, ZOOM_MAX,
    } = ui

    async function api(action, args) {
      const res = await fetch(API + '/' + encodeURIComponent(action), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      })
      let data = null
      try { data = await res.json() } catch (e) { data = null }
      if (data && data.error) throw new Error(data.error)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return data
    }

    // 教师端图标：文件夹 + 勾，和学生的对话气泡区分开
    function TeaIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.6 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M8.5 13.2l2.2 2.2 4.4-4.6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    // ── 审计：改状态、改标题/总结、写归档说明 ──
    function AuditBox({ st, set, onAudit, onAnswer }) {
      const t = st.thread
      if (!t) return null
      const isPublic = t.fields.audit === 'shared'
      const turns = t.turns || []
      const teacherTurns = turns.filter((x) => x.by === 'teacher')
      return h('div', { className: 'k56' },
        // 答复与去向分开两段：答复是内容，审计是去向。
        // 混在一起会出现「为了答复学生而不得不先决定是否公开」这种别扭流程。
        h('div', { className: 'k64' }, '答复这个学生'),
        teacherTurns.length
          ? h('div', { className: 'k57' }, '你已经答过 ' + teacherTurns.length + ' 次；学生端会在最前面单独显示教师答复。')
          : h('div', { className: 'k57' }, '还没有教师答复。学生端会把教师答复与 AI 答复**分开显示** —— 两者的可信度不是一个级别，界面上不能混为一谈。'),
        h('textarea', { className: 'k59', rows: 3, value: st.answerText, placeholder: '写给学生看的回答（可以只答复、暂不决定是否公开）', onChange: (e) => set({ answerText: e.target.value }) }),
        h('div', { className: 'k60' },
          h('button', { className: 'k42 k11', disabled: st.busy || !(st.answerText || '').trim(), onClick: () => onAnswer(t.path, st.answerText) },
            st.busy ? '提交中…' : '答复（只发给该学生）'),
          h('span', { className: 'k54' }),
          h('span', { className: 'k57' }, '答复会追加进这条提问的对话线程；如果它已经公开，公共面那份会同步更新，否则两边内容会不一致。')),

        h('div', { className: 'k64' }, '审计去向'),
        h('div', { className: 'k57' }, isPublic
          ? '当前：已公开给全班（公共面里有副本）'
          : '当前：仅该学生可见'),
        h('div', { className: 'k60' },
          h('input', { className: 'k61', style: { flex: '1 1 auto' }, value: st.auditTitle, placeholder: '标题（留空则不改；这是统一风格的最后一关，你可以覆盖模型凝练的结果）', onChange: (e) => set({ auditTitle: e.target.value }) }),
          ),
        h('textarea', { className: 'k59', rows: 2, value: st.auditSummary, placeholder: '问题总结（留空则不改）', onChange: (e) => set({ auditSummary: e.target.value }) }),
        h('textarea', { className: 'k59', rows: 2, value: st.auditNote, placeholder: '归档说明（例如：讲课时补一句「负特征值是鞍点的充分判据」）', onChange: (e) => set({ auditNote: e.target.value }) }),
        h('div', { className: 'k60' },
          h('button', { className: 'k42 k11', onClick: () => onAudit(t.path, 'shared') }, '值得共享（进公共池）'),
          h('button', { className: 'k42', onClick: () => onAudit(t.path, 'private') }, isPublic ? '撤下（只答本人）' : '只答本人'),
          h('span', { className: 'k54' }),
          h('span', { className: 'k57' }, '「值得共享」会写一份副本到 课程问题池\\公共\\，下次 publish 带给全班；原条仍留在该学生的私有目录里，他的历史不会消失。')))
    }

    function ThreadDetail({ st, set, onAudit, onAnswer }) {
      const t = st.thread
      if (!t) return h('div', { className: 'k21' }, '从左边选一条提问。')
      return h('div', { className: 'k46' },
        h('div', { className: 'k10' }, t.fields.title || '(无标题)'),
        h('div', { className: 'k70' },
          bdg(t.fields.student || '未标注学生', 'var(--dsw-alias-brand-primary)'),
          bdg(t.fields.lesson || '未标注', 'var(--dsw-alias-bg-layer-1)'),
          bdg(t.fields.severity || '中', SEVERITY_COLOR[t.fields.severity] || 'gray'),
          bdg(t.fields.status || '', STATUS_COLOR[t.fields.status] || 'gray'),
          t.fields.audit === 'shared' ? bdg('已公开', 'var(--dsw-alias-state-success-primary)') : bdg('私有', 'var(--dsw-alias-label-secondary)'),
          t.fields.tokens ? h('span', { className: 'k57' }, '该生消耗 tokens ' + t.fields.tokens) : null),
        t.fields.summary ? h('div', { className: 'k58' }, '总结：' + t.fields.summary) : null,
        h('div', { className: 'k57' }, '路径：' + t.path),
        h('div', { className: 'k64' }, '完整问答（' + ((t.turns || []).length + 1) + ' 轮，全班可见的是这一份）'),
        h(Markdown, { text: t.body || '' }),
        h(AuditBox, { st, set, onAudit, onAnswer }))
    }

    // ── 提问列表（可筛学生 / 只看私有 / 只看已公开）──
    function QuestionList({ st, set, onOpen }) {
      const items = st.items || []
      const filtered = items.filter((it) => {
        if (st.filterStudent && it.student !== st.filterStudent) return false
        if (st.filterScope === 'private' && it.audit === 'shared') return false
        if (st.filterScope === 'shared' && it.audit !== 'shared') return false
        return true
      })
      return h('div', { className: 'k67' },
        h('div', { className: 'k60' },
          h('select', { className: 'k61', value: st.filterStudent, onChange: (e) => set({ filterStudent: e.target.value }) },
            [h('option', { key: '', value: '' }, '全部学生')].concat((st.students || []).map((s) => h('option', { key: s, value: s }, s)))),
          h('select', { className: 'k61', value: st.filterScope, onChange: (e) => set({ filterScope: e.target.value }) },
            h('option', { key: 'all', value: 'all' }, '全部'),
            h('option', { key: 'private', value: 'private' }, '仅私有（待审计）'),
            h('option', { key: 'shared', value: 'shared' }, '已公开')),
          h('span', { className: 'k57' }, filtered.length + ' / ' + items.length + ' 条')),
        filtered.length ? filtered.map((it) => h('div', {
          key: it.path, className: 'k45', 'data-sel': st.selPath === it.path ? '1' : '0',
          onClick: () => onOpen(it.path),
        },
          h('div', { className: 'k64', style: { margin: 0 } }, it.title),
          h('div', { className: 'k70' },
            bdg(it.student || '?', 'var(--dsw-alias-brand-primary)'),
            bdg(it.lesson || '未标注', 'var(--dsw-alias-bg-layer-1)'),
            bdg(it.severity || '中', SEVERITY_COLOR[it.severity] || 'gray'),
            it.audit === 'shared' ? bdg('已公开', 'var(--dsw-alias-state-success-primary)') : null,
            it.turns ? bdg(it.turns + ' 轮', 'var(--dsw-alias-bg-layer-1)') : null))) : h('div', { className: 'k21' }, '没有符合条件的提问'))
    }

    // ── 共性问题：判据是「几个不同学生」 ──
    function Common({ st, set, onBatch }) {
      const groups = st.common || []
      return h('div', { className: 'k46' },
        h('div', { className: 'k64' }, '共性问题汇总'),
        h('div', { className: 'k57' }, '判据是**几个不同学生**踩到，不是一个学生问了几次：一个人反复问同一件事，那是他自己的困惑；三个人各问一次，那才是教案或讲法的问题。'),
        h('div', { className: 'k60' },
          h('span', { className: 'k57' }, '门槛：'),
          h('select', { className: 'k61', value: String(st.minStudents), onChange: (e) => set({ minStudents: e.target.value }) },
            h('option', { key: '1', value: '1' }, '≥1 个学生'),
            h('option', { key: '2', value: '2' }, '≥2 个学生'),
            h('option', { key: '3', value: '3' }, '≥3 个学生'))),
        groups.length ? groups.map((g, i) => h('div', { key: i, className: 'k56' },
          h('div', { className: 'k70' },
            bdg(g.studentCount + ' 人踩到', g.studentCount >= 2 ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)'),
            bdg(g.lesson, 'var(--dsw-alias-bg-layer-1)'),
            g.maxSeverity ? bdg('最高 ' + g.maxSeverity, SEVERITY_COLOR[g.maxSeverity] || 'gray') : null,
            bdg(g.count + ' 条', 'var(--dsw-alias-bg-layer-1)'),
            g.alreadyShared ? bdg('已有公开副本', 'var(--dsw-alias-state-success-primary)') : null),
          h('div', { className: 'k64', style: { margin: '4px 0' } }, g.sample || '(无标题)'),
          h('div', { className: 'k57' }, '涉及学生：' + (g.students || []).join('、')),
          h('div', { className: 'k60' },
            h('button', { className: 'k42 k11', disabled: g.alreadyShared, onClick: () => onBatch(g.paths, 'shared') }, '这一组都标为值得共享'),
            h('button', { className: 'k42', onClick: () => onBatch(g.paths, 'private') }, '这一组都标为只答本人'),
            h('span', { className: 'k54' }),
            h('span', { className: 'k57' }, '沉淀去向建议：' + (g.studentCount >= 3 ? '写进 FAQ，并考虑改教案' : '先只答本人，观察是否扩散')))))
          : h('div', { className: 'k21' }, '还没有足够数据形成共性问题'))
    }

    // ── 学生提交 ──
    function Submissions({ st, set, onRead }) {
      const files = st.subs || []
      return h('div', { className: 'k46' },
        h('div', { className: 'k64' }, '学生提交（' + files.length + '）'),
        h('div', { className: 'k60' },
          h('select', { className: 'k61', value: st.subStudent, onChange: (e) => set({ subStudent: e.target.value }) },
            [h('option', { key: '', value: '' }, '全部学生')].concat((st.subStudents || []).map((s) => h('option', { key: s, value: s }, s))))),
        files.length ? files.map((f) => h('div', { key: f.path, className: 'k45', onClick: () => onRead(f.path) },
          h('span', { className: 'k64', style: { margin: 0 } }, f.name),
          h('span', { className: 'k57' }, ' ' + (f.student || '') + ' · ' + Math.round((f.bytes || 0) / 1024) + ' KB'))) : h('div', { className: 'k21' }, '还没有提交'),
        st.subText ? h('div', { className: 'k46' },
          h('div', { className: 'k64' }, st.subName),
          h('pre', { className: 'k63', style: { maxHeight: '360px', overflow: 'auto' } }, st.subText)) : null)
    }

    // ── 课堂记录汇总（归档用）──
    function Digest({ st }) {
      const d = st.digest
      if (!d) return h('div', { className: 'k21' }, '汇总加载中…')
      return h('div', { className: 'k46' },
        h('div', { className: 'k64' }, '课堂记录汇总'),
        h('div', { className: 'k57' }, '生成于 ' + (d.generatedAt || '') + '。按课时统计提问，可用于课后改教案或写答疑课提纲。'),
        (d.lessons || []).map((l) => h('div', { key: l.lesson, className: 'k56' },
          h('div', { className: 'k70' },
            bdg(l.lesson, 'var(--dsw-alias-brand-primary)'),
            bdg(l.total + ' 条', 'var(--dsw-alias-bg-layer-1)'),
            bdg(l.students + ' 名学生', 'var(--dsw-alias-bg-layer-1)'),
            l.shared ? bdg(l.shared + ' 条已公开', 'var(--dsw-alias-state-success-primary)') : null),
          h('div', { className: 'k57' }, '类型：' + Object.keys(l.byType).map((k) => k + '(' + l.byType[k] + ')').join(' · ')),
          h('div', { className: 'k57' }, '严重度：' + Object.keys(l.bySeverity).map((k) => k + '(' + l.bySeverity[k] + ')').join(' · ')),
          (l.titles || []).slice(0, 12).map((t, i) => h('div', { key: i, className: 'k57' }, '· #' + t.id + ' ' + t.title + (t.student ? ('（' + t.student + '）') : ''))))))
    }

    // ── 发布 ──
    function Publish({ st, set, onRefresh, onPublish }) {
      const s = st.staged
      if (!s) return h('div', { className: 'k21' }, '加载中…')
      const r = st.publishResult
      return h('div', { className: 'k46' },
        h('div', { className: 'k64' }, '归档与发布'),
        h('div', { className: 'k57' }, '工作区：' + s.workspace),
        h('div', { className: 'k57' }, '公共面：' + s.publicDir + '（' + (s.files || []).length + ' 份）'),
        (s.files || []).length ? (s.files || []).map((f, i) => h('div', { key: i, className: 'k45' }, f))
          : h('div', { className: 'k21' }, '公共面还是空的 —— 先在「提问与审计」里把值得共享的标出来'),
        h('div', { className: 'k64' }, '发布到公开仓'),
        h('div', { className: 'k57' }, '插件里能替你跑前两步（写公开仓工作区、生成 课程.json 与 公开问答.json）。' +
          '第三步 git commit / push 要你自己敲 —— 那一步用你的凭据，插件里不放任何人的密钥。'),
        h('div', { className: 'k60' },
          h('button', { className: 'k42', disabled: st.busy, onClick: () => onPublish('check') }, '先检查会发哪些文件'),
          h('button', { className: 'k42 k11', disabled: st.busy, onClick: () => onPublish('publish') }, st.busy ? '执行中…' : '发布（写公开仓工作区）'),
          h('span', { className: 'k54' }),
          h('button', { className: 'k42', onClick: onRefresh }, '刷新清单')),
        r ? h('div', { className: 'k46' },
          h('div', { className: 'k64' }, r.ok ? ('发布工具执行成功（' + r.mode + '）') : ('发布工具失败：' + (r.error || ('exit ' + r.exit)))),
          r.output ? h('pre', { className: 'k63', style: { maxHeight: '260px', overflow: 'auto' } }, r.output) : null,
          r.next ? h('div', null,
            h('div', { className: 'k57' }, '剩下三步请你自己执行：'),
            r.next.map((x, i) => h('div', { key: i, className: 'k45' }, x)),
            r.note ? h('div', { className: 'k57' }, r.note) : null) : null) : null,
        h('div', { className: 'k57' }, '学生在面板「公开问答」里能看到新增的问题与总结；他们的客户端下次拉取仓库时同步。'),
        h('div', { className: 'k64' }, '学生提交（' + (s.submissions || []).length + '）'),
        (s.submissions || []).slice(0, 30).map((f, i) => h('div', { key: i, className: 'k57' }, '· ' + f.student + ' / ' + f.name)))
    }

    // ── 面板 ──
    function Panel() {
      const [st, set] = React.useState({
        view: 'questions', mode: 'region', chapter: '第一章', slideIndex: 0, zoom: 1,
        items: [], students: [], filterStudent: '', filterScope: 'all',
        minStudents: '2', common: [], subs: [], subStudents: [], subStudent: '',
        auditTitle: '', auditSummary: '', auditNote: '', answerText: '', subText: '', subName: '', busy: false,
      })
      const loadThreads = React.useCallback(async () => {
        const r = await api('threads', {})
        set({ items: r.items || [], students: r.students || [] })
      }, [])
      const loadCommon = React.useCallback(async (min) => {
        const r = await api('common', { minStudents: Number(min || 2) })
        set({ common: r.groups || [] })
      }, [])
      const loadSubs = React.useCallback(async () => {
        const r = await api('submissions', {})
        set({ subs: r.files || [], subStudents: r.students || [] })
      }, [])
      const loadAll = React.useCallback(async () => {
        try {
          const info = await api('info', {})
          set({ info })
          set({ tree: (await api('tree', {})).tree })
          const ch = (info.chapters && info.chapters[0]) || '第一章'
          set({ chapter: ch, slides: await api('slides', { chapter: ch }) })
          await loadThreads()
          await loadCommon('2')
          await loadSubs()
          set({ digest: await api('digest', {}) })
          set({ staged: await api('staged', {}) })
        } catch (err) { set({ error: '加载失败：' + ((err && err.message) || String(err)) }) }
      }, [loadThreads, loadCommon, loadSubs])
      const openThread = React.useCallback(async (path) => {
        try {
          const t = await api('thread', { path })
          set({ thread: t, selPath: path, view: 'detail', auditTitle: '', auditSummary: '', auditNote: '', answerText: '' })
        } catch (err) { set({ error: '读取失败：' + ((err && err.message) || String(err)) }) }
      }, [])
      const onAudit = React.useCallback(async (path, decision) => {
        const cur = st
        set({ busy: true, error: '' })
        try {
          const r = await api('audit', {
            path, decision,
            title: cur.auditTitle || undefined,
            summary: cur.auditSummary || undefined,
            note: cur.auditNote || undefined,
          })
          set({ busy: false, notice: decision === 'shared' ? ('已公开：' + r.publicPath) : '已标为只答本人' })
          await openThread(path)
          await loadThreads(); await loadCommon(cur.minStudents); set({ staged: await api('staged', {}) })
        } catch (err) { set({ busy: false, error: '审计失败：' + ((err && err.message) || String(err)) }) }
      }, [st, openThread, loadThreads, loadCommon])
      const onAnswer = React.useCallback(async (path, text) => {
        set({ busy: true, error: '' })
        try {
          const r = await api('answer', { path, text })
          set({ busy: false, answerText: '', notice: '已答复' + (r.syncedPublic ? '（公共面那份也同步了）' : '') + '，该学生在「我的提问」里会看到' })
          await openThread(path)
          await loadThreads()
        } catch (err) { set({ busy: false, error: '答复失败：' + ((err && err.message) || String(err)) }) }
      }, [openThread, loadThreads])
      const onPublish = React.useCallback(async (mode) => {
        set({ busy: true, error: '', publishResult: null })
        try {
          const r = await api('publish', { mode })
          set({ busy: false, publishResult: r, notice: r.ok ? ('发布工具执行成功（' + mode + '）') : '发布工具返回失败，看下面的输出' })
          if (r.ok && mode === 'publish') set({ staged: await api('staged', {}) })
        } catch (err) { set({ busy: false, error: '发布失败：' + ((err && err.message) || String(err)) }) }
      }, [])
      const onBatch = React.useCallback(async (paths, decision) => {
        set({ busy: true, error: '' })
        try {
          const r = await api('audit.batch', { paths, decision })
          set({ busy: false, notice: '批量完成 ' + r.done + ' / ' + paths.length })
          await loadThreads(); await loadCommon(String(st.minStudents)); set({ staged: await api('staged', {}) })
        } catch (err) { set({ busy: false, error: '批量审计失败：' + ((err && err.message) || String(err)) }) }
      }, [st.minStudents, loadThreads, loadCommon])
      const onReadSub = React.useCallback(async (path) => {
        try {
          const r = await api('submission.read', { path })
          set({ subText: r.text, subName: r.name })
        } catch (err) { set({ error: '读取失败：' + ((err && err.message) || String(err)) }) }
      }, [])

      React.useEffect(() => { loadAll() }, [loadAll])
      React.useEffect(() => { loadKatex({ onDone: (ok, err) => set(ok ? { katexReady: true } : { katexError: err || '未知' }) }) }, [])
      React.useEffect(() => { if (st.view === 'common') loadCommon(st.minStudents) }, [st.minStudents, st.view, loadCommon])

      const views = [
        { id: 'questions', label: '提问与审计' },
        { id: 'common', label: '共性问题' },
        { id: 'submissions', label: '学生提交' },
        { id: 'digest', label: '课堂汇总' },
        { id: 'publish', label: '归档发布' },
      ]
      const c = st.info && st.info.counts ? st.info.counts : {}
      return h('div', { className: 'k22' },
        h('div', { className: 'k23' },
          h('div', null,
            h('div', { className: 'k9a' },
              h('div', { className: 'k10' }, '课程问题池 · 教师端'),
              h('span', { className: 'k9b', 'data-role': 'teacher', title: '教师端：可以审计、归档、发布；这一侧不调用模型，不产生 token 费用' }, '教师'),
              st.info && st.info.teacher ? h('span', { className: 'k9c' }, st.info.teacher) : null,
              st.info && st.info.courseCode ? h('span', { className: 'k9c' }, st.info.courseCode) : null),
            h('div', { className: 'k41' }, st.info
              ? ('提问 ' + (c.items || 0) + ' 条 · 学生 ' + (c.students || 0) + ' 人 · 提交 ' + (c.submissions || 0) + ' 份 · 已公开 ' + ((c.byScope && c.byScope.public) || 0) + ' 条')
              : '加载中…')),
          h('div', { className: 'k54' }),
          h('div', { className: 'k24' }, views.map((v) => h('span', {
            key: v.id, className: 'k43', 'data-on': (st.view === v.id || (v.id === 'questions' && st.view === 'detail')) ? '1' : '0',
            onClick: () => set({ view: v.id }),
          }, v.label))),
          h('button', { className: 'k42', disabled: st.busy, onClick: loadAll }, st.busy ? '处理中…' : '刷新')),
        st.error ? h('div', { className: 'k52 k53', style: { margin: '8px 14px 0' } }, st.error) : null,
        st.notice ? h('div', { className: 'k52 k62', style: { margin: '8px 14px 0' } }, st.notice) : null,
        h('div', { className: 'k25' },
          h('div', { className: 'k44 k26' },
            h('div', { className: 'k64' }, '章节'),
            h('div', { className: 'k70' }, ((st.info && st.info.chapters) || ['第一章']).map((ch) => h('span', {
              key: ch, className: 'k71', 'data-on': st.chapter === ch ? '1' : '0',
              onClick: async () => set({ chapter: ch, slides: await api('slides', { chapter: ch }) }),
            }, ch))),
            h('div', { className: 'k64' }, '课时脉络'),
            h('div', { className: 'k1' }, st.tree ? h(Fishbone, { tree: st.tree, selected: 0, onPick: () => {} })
              : h('div', { className: 'k21' }, '索引加载中…'))),
          h('div', { className: 'k27' },
            st.view === 'questions' ? h(QuestionList, { st, set, onOpen: openThread }) : null,
            st.view === 'detail' ? h(ThreadDetail, { st, set, onAudit, onAnswer }) : null,
            st.view === 'common' ? h(Common, { st, set, onBatch }) : null,
            st.view === 'submissions' ? h(Submissions, { st, set, onRead: onReadSub }) : null,
            st.view === 'digest' ? h(Digest, { st }) : null,
            st.view === 'publish' ? h(Publish, { st, set, onRefresh: async () => set({ staged: await api('staged', {}) }), onPublish }) : null)))
    }

    const inject = ['slots', 'timer']
    function apply(ctx) {
      const disposers = []
      ensureCss()
      try {
        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 42, label: '课程问题池（教师）',
        }, (props) => h(TeaIcon, props))))
      } catch (error) { console.error('[cip-tea] 侧栏注册抛错', error) }
      try {
        disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, () => h(Panel, {}))))
      } catch (error) { console.error('[cip-tea] 主面板注册抛错', error) }
      ctx.effect(() => () => {
        for (const d of disposers) { try { d() } catch (error) { console.error('[cip-tea] dispose failed', error) } }
      }, 'course-teacher cleanup')
      console.log('[cip-tea] client apply 完毕（v1）')
    }

    exports.name = 'course-panel-teacher'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
