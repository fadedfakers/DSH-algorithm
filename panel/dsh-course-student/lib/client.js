/**
 * dsh-course-student —— 学生端客户端半区
 *
 * 学生端承担模型费用，所以这一侧的界面必须让三件事一眼可见：
 *   · 我这次提问/批改花了多少 token（额度页）
 *   · 哪些问题是「只属于我」的，哪些是老师公开给全班的
 *   · 追问每一轮都会真的调模型（不是「同上」）
 */
window.__ModuleLoader__.load({
  id: 'dsh-course-student',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    const PANEL_ID = 'course-student'
    const API = '/cip-stu-api'
    const MEDIA = '/cip-stu-media'

    // 必须在 require 共享核心**之前**写好：核心在工厂执行时读这个全局。
    globalThis.__CIP_UI_CFG__ = {
      katex: '/cip-stu-katex', css: '/cip-stu.css', cssId: 'cip-stu-css', media: MEDIA,
    }
    const ui = require('dsh-course-client-core')
    const {
      ensureCss, css, h, bdg, Markdown, loadKatex, Fishbone, MediaImage,
      STATUS_COLOR, SEVERITY_COLOR, ZOOM_MIN, ZOOM_MAX,
      MODULES, TYPES, SEVERITIES,
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

    // 侧栏图标：对话气泡 + 问号，与教师端的图标区分开
    function StuIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H11l-4.2 4v-4H5.5A1.5 1.5 0 0 1 4 14.5v-9Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M9.6 8.2a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.8.6-.8 1.1v.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 13.9, r: 0.95, fill: 'currentColor' }))
    }

    // ── 课件：框选一块图区，或拖选文字 ──
    function Slides({ st, set }) {
      const data = st.slides
      const wrapRef = React.useRef(null)
      if (!data || !data.slides || !data.slides.length) return h('div', { className: 'k21' }, '课件未加载')
      const idx = Math.min(Math.max(0, st.slideIndex || 0), data.slides.length - 1)
      const slide = data.slides[idx]
      const zoom = st.zoom || 1
      const W = data.slideWidth
      const H = data.slideHeight

      const pos = (ev) => {
        const r = wrapRef.current.getBoundingClientRect()
        const k = r.width / W
        return { x: (ev.clientX - r.left) / k, y: (ev.clientY - r.top) / k }
      }
      const onDown = (ev) => {
        if (st.mode !== 'region' || ev.button !== 0 || !wrapRef.current) return
        const p = pos(ev)
        set({ dragging: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } })
      }
      const onMove = (ev) => {
        if (!st.dragging || !wrapRef.current) return
        const p = pos(ev)
        set({ dragging: Object.assign({}, st.dragging, { x1: p.x, y1: p.y }) })
      }
      const onUp = () => {
        const d = st.dragging
        if (!d) return
        const box = {
          x: Math.max(0, Math.min(d.x0, d.x1)), y: Math.max(0, Math.min(d.y0, d.y1)),
          w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0),
        }
        set({ dragging: null })
        if (box.w < 8 || box.h < 8) return
        set({ picked: {
          kind: 'region', box,
          origin: st.chapter + ' 第 ' + slide.index + ' 页 · 区域 (' + Math.round(box.x) + ',' + Math.round(box.y) + ') ' + Math.round(box.w) + '×' + Math.round(box.h),
        } })
      }

      const dragging = st.dragging
      const dragBox = dragging ? {
        left: Math.min(dragging.x0, dragging.x1), top: Math.min(dragging.y0, dragging.y1),
        width: Math.abs(dragging.x1 - dragging.x0), height: Math.abs(dragging.y1 - dragging.y0),
      } : null

      return h('div', { className: 'k18' },
        h('div', { className: 'k20' },
          h('button', { className: 'k42', onClick: () => set({ slideIndex: Math.max(0, idx - 1), picked: null }) }, '← 上一页'),
          h('span', null, '第 ' + slide.index + ' / ' + data.slides.length + ' 页'),
          h('button', { className: 'k42', onClick: () => set({ slideIndex: Math.min(data.slides.length - 1, idx + 1), picked: null }) }, '下一页 →'),
          h('span', { className: 'k54' }),
          h('span', { className: 'k43', 'data-on': st.mode === 'region' ? '1' : '0', onClick: () => set({ mode: 'region' }) }, '框选图区'),
          h('span', { className: 'k43', 'data-on': st.mode === 'text' ? '1' : '0', onClick: () => set({ mode: 'text' }) }, '拖选文字'),
          h('button', { className: 'k42', onClick: () => set({ zoom: Math.max(ZOOM_MIN, zoom / 1.25) }) }, '－'),
          h('button', { className: 'k42', onClick: () => set({ zoom: Math.min(ZOOM_MAX, zoom * 1.25) }) }, '＋'),
          h('span', { className: 'k57' }, st.mode === 'region' ? '在页面上拖一个框' : '选中文字后点浮出的按钮')),
        h('div', {
          ref: wrapRef, className: 'k0',
          style: { width: (W * zoom) + 'px', height: (H * zoom) + 'px' },
          onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp, onMouseLeave: onUp,
        },
          h('div', { className: 'k17', style: { width: W + 'px', height: H + 'px', transform: 'scale(' + zoom + ')', transformOrigin: '0 0' } },
            slide.shapes.map((s, i) => h('div', {
              key: 's' + i, className: 'k47',
              style: css('left:' + s.x + 'px;top:' + s.y + 'px;width:' + s.w + 'px;height:' + s.h + 'px;font-size:' + (s.maxPt ? Math.max(9, Math.min(30, s.maxPt * 0.92)) : 13) + 'px;font-weight:' + (s.bold ? 600 : 400) + ';'),
            }, s.text)),
            (slide.media || []).map((m, i) => {
              const bs = css('left:' + m.x + 'px;top:' + m.y + 'px;width:' + m.w + 'px;height:' + m.h + 'px;')
              if (!m.file) return h('div', { key: 'm' + i, className: 'k55', style: bs }, h('b', null, '图片不可用'), h('span', null, m.name))
              // 路由在这里拼：宿主返回的是**裸文件名**。它曾经自己拼过一次前缀，
              // 两边各拼一次 → /cip-stu-media/第一章//cip-stu-media/第一章/x.png → 400，
              // 表现就是「所有图片都加载不出来」。
              const src = MEDIA + '/' + encodeURIComponent(st.chapter) + '/' + encodeURIComponent(m.file)
              return h(MediaImage, { key: 'm' + i, src, name: m.name, boxStyle: bs, st, set })
            }),
            dragBox ? h('div', { className: 'k48', style: css('left:' + dragBox.left + 'px;top:' + dragBox.top + 'px;width:' + dragBox.width + 'px;height:' + dragBox.height + 'px;') }) : null)))
    }

    // ── 提问条 ──
    function AskBar({ st, set, onAsk }) {
      const p = st.picked
      return h('div', { className: 'k56' },
        h('div', { className: 'k64' }, '就这块提问'),
        p ? h('div', { className: 'k57' }, '证据：' + p.origin)
          : h('div', { className: 'k57' }, '先在课件上框选一块图区（或拖选文字）'),
        h('textarea', {
          className: 'k59', rows: 3, placeholder: '你想问什么？',
          value: st.q || '', onChange: (e) => set({ q: e.target.value }),
        }),
        h('div', { className: 'k60' },
          h('select', { className: 'k61', value: st.f.module, onChange: (e) => set({ f: Object.assign({}, st.f, { module: e.target.value }) }) }, MODULES.map((x) => h('option', { key: x, value: x }, x))),
          h('select', { className: 'k61', value: st.f.type, onChange: (e) => set({ f: Object.assign({}, st.f, { type: e.target.value }) }) }, TYPES.map((x) => h('option', { key: x, value: x }, x))),
          h('select', { className: 'k61', value: st.f.severity, onChange: (e) => set({ f: Object.assign({}, st.f, { severity: e.target.value }) }) }, SEVERITIES.map((x) => h('option', { key: x, value: x }, x))),
          h('input', { className: 'k61', style: { width: '110px' }, placeholder: '课时号', value: st.f.lesson, onChange: (e) => set({ f: Object.assign({}, st.f, { lesson: e.target.value }) }) }),
          h('span', { className: 'k54' }),
          h('button', { className: 'k42 k11', disabled: st.asking || !(st.q || '').trim(), onClick: onAsk }, st.asking ? 'AI 作答中…' : '提交提问')),
        h('div', { className: 'k57' }, '提交后会：① 凝练一句统一风格的标题 ② AI 作答 ③ 生成问题总结。之后每一轮追问都会重新调用模型，费用记在你自己账号上。'))
    }

    // ── 问答详情：完整多轮 + 继续追问 ──
    function ThreadView({ st, set, onFollowup }) {
      const t = st.thread
      if (!t) return h('div', { className: 'k21' }, '从左边选一条提问。')
      const turns = t.turns || []
      return h('div', { className: 'k46' },
        h('div', { className: 'k10' }, t.fields.title || '(无标题)'),
        h('div', { className: 'k70' },
          bdg(t.fields.lesson || '未标注', 'var(--dsw-alias-bg-layer-1)'),
          bdg(t.fields.severity || '中', SEVERITY_COLOR[t.fields.severity] || 'gray'),
          bdg(t.fields.status || '', STATUS_COLOR[t.fields.status] || 'gray'),
          t.fields.audit === 'shared' ? bdg('已公开给全班', 'var(--dsw-alias-state-success-primary)') : bdg('仅我可见', 'var(--dsw-alias-label-secondary)'),
          t.fields.tokens ? h('span', { className: 'k57' }, 'tokens ' + t.fields.tokens) : null),
        t.fields.summary ? h('div', { className: 'k58' }, '总结：' + t.fields.summary) : null,
        h('div', { className: 'k64' }, '完整问答（' + (turns.length + 1) + ' 轮）'),
        h(Markdown, { text: t.body || '' }),
        t.fields.audit === 'shared'
          ? h('div', { className: 'k57' }, '这条已被老师标为「值得共享」，全班都能看到完整问答。')
          : h('div', { className: 'k57' }, '这条目前只有你能看到。老师审核后才可能共享给全班。'),
        h('div', { className: 'k56' },
          h('div', { className: 'k64' }, '继续追问'),
          h('textarea', {
            className: 'k59', rows: 2, placeholder: '再问一轮（每一轮都会真的调模型作答，不会说「同上」）',
            value: st.followup || '', onChange: (e) => set({ followup: e.target.value }),
          }),
          h('div', { className: 'k60' },
            h('span', { className: 'k57' }, '已 ' + turns.length + ' 轮'),
            h('span', { className: 'k54' }),
            h('button', {
              className: 'k42 k11', disabled: st.asking || !(st.followup || '').trim(),
              onClick: () => onFollowup(t.path, st.followup),
            }, st.asking ? 'AI 作答中…' : '追问'))))
    }

    // ── 问题列表：我的 / 已公开 ──
    function ThreadList({ st, set, onOpen }) {
      const mine = st.mine || []
      const pub = st.publicItems || []
      const row = (it) => h('div', {
        key: it.path, className: 'k45', 'data-sel': st.selPath === it.path ? '1' : '0',
        onClick: () => onOpen(it.path),
      },
        h('div', { className: 'k64', style: { margin: 0 } }, it.title),
        h('div', { className: 'k70' },
          bdg(it.lesson || '未标注', 'var(--dsw-alias-bg-layer-1)'),
          bdg(it.severity || '中', SEVERITY_COLOR[it.severity] || 'gray'),
          it.turns ? bdg(it.turns + ' 轮追问', 'var(--dsw-alias-bg-layer-1)') : null,
          h('span', { className: 'k57' }, it.created || '')))
      return h('div', { className: 'k67' },
        h('div', { className: 'k64' }, '我的提问（' + mine.length + '）'),
        mine.length ? mine.map(row) : h('div', { className: 'k21' }, '还没有提问'),
        h('div', { className: 'k64' }, '老师公开给全班的（' + pub.length + '）'),
        pub.length ? pub.map(row) : h('div', { className: 'k21' }, '暂时没有已公开的问题'))
    }

    // ── 作业批改 ──
    function Homework({ st, set, onGrade }) {
      const tree = st.tree
      const lessons = []
      for (const m of (tree && tree.modules) || []) for (const l of m.lessons || []) lessons.push({ m: m.name, l })
      return h('div', { className: 'k46' },
        h('div', { className: 'k64' }, '作业批改（以教案为对齐基准，费用记在你账号上）'),
        h('div', { className: 'k70' },
          h('select', { className: 'k61', value: st.hwLesson, onChange: (e) => set({ hwLesson: e.target.value, hwResult: null }) },
            [h('option', { key: '', value: '' }, '选择课时…')].concat(
              lessons.filter((x) => x.l.hasPlan).map((x) => h('option', { key: x.l.no, value: String(x.l.no) }, 'L' + x.l.no + ' ' + x.l.title)))),
          h('input', { type: 'file', className: 'k61', onChange: (e) => {
            const f = e.target.files && e.target.files[0]
            if (!f) return
            const rd = new FileReader()
            rd.onload = () => set({ hwText: String(rd.result || ''), hwName: f.name })
            rd.readAsText(f)
          } }),
          h('button', { className: 'k42 k11', disabled: st.busy || !st.hwText, onClick: onGrade }, st.busy ? '批改中…' : '按教案批改')),
        h('div', { className: 'k57' }, st.hwName ? ('已载入 ' + st.hwName + '（' + (st.hwText || '').length + ' 字符）') : '选一个课时与文件；只有已发布教案的课时可批改'),
        st.hwResult ? h('div', { className: 'k46' },
          h('div', { className: 'k64' }, '批改结果'),
          h('div', { className: 'k57' }, '教案基准：' + (st.hwResult.planRel || '未找到')),
          h(Markdown, { text: st.hwResult.text || '' }),
          st.hwResult.issues && st.hwResult.issues.length
            ? h('div', null,
              h('div', { className: 'k64' }, '已记入问题池的 ' + st.hwResult.issues.length + ' 条问题'),
              st.hwResult.issues.map((x, i) => h('div', { key: i, className: 'k45' }, bdg(x.severity, SEVERITY_COLOR[x.severity] || 'gray'), ' ' + x.text)))
            : null) : null)
    }

    // ── 额度 ──
    function Usage({ st }) {
      const u = st.usage
      if (!u) return h('div', { className: 'k21' }, '额度统计加载中…')
      return h('div', { className: 'k46' },
        h('div', { className: 'k64' }, '我的模型用量（' + (u.student || '') + '）'),
        h('div', { className: 'k57' }, '输入 tokens ' + u.inputTokens + ' · 输出 tokens ' + u.outputTokens + ' · 共 ' + u.items + ' 条记录'),
        h('div', { className: 'k57' }, '提问、每一轮追问、标题凝练、问题总结、作业批改都记为你的消耗；教师端的整理与审计不调用模型。'),
        (u.per || []).map((x) => h('div', { key: x.id + x.title, className: 'k45' },
          h('span', { className: 'k64', style: { margin: 0 } }, '#' + x.id + ' ' + x.title),
          h('span', { className: 'k57' }, ' ' + (x.tokens || '') + (x.turns ? (' · ' + x.turns + ' 轮追问') : '')))))
    }

    // ── 面板 ──
    function Panel() {
      const [st, set] = React.useState({
        view: 'chapter', mode: 'region', chapter: '第一章', slideIndex: 0, zoom: 1,
        q: '', followup: '', asking: false, busy: false, picked: null, dragging: null,
        f: { module: '模块一', type: '概念问题', severity: '中', lesson: '' },
        hwLesson: '', hwName: '', hwText: '', hwResult: null,
      })
      const stRef = React.useRef(st); stRef.current = st

      const loadThreads = React.useCallback(async () => {
        const r = await api('threads', {})
        set({ mine: r.mine || [], publicItems: r.public || [] })
      }, [])
      const load = React.useCallback(async () => {
        try {
          const info = await api('info', {})
          set({ info })
          const tree = (await api('tree', {})).tree
          set({ tree })
          const ch = (info.chapters && info.chapters[0]) || '第一章'
          const slides = await api('slides', { chapter: ch })
          set({ chapter: ch, slides })
          // 第一张有图的页，避免一进来停在空白页
          if (slides && slides.slides) {
            const i = slides.slides.findIndex((s) => (s.media || []).some((m) => m.file))
            if (i > 0) set({ slideIndex: i })
          }
          await loadThreads()
          set({ usage: await api('usage', {}) })
        } catch (err) { set({ error: '加载失败：' + ((err && err.message) || String(err)) }) }
      }, [loadThreads])
      const switchChapter = React.useCallback(async (ch) => {
        set({ chapter: ch, slideIndex: 0, picked: null, slides: null })
        set({ slides: await api('slides', { chapter: ch }) })
      }, [])
      const openThread = React.useCallback(async (path) => {
        try {
          set({ thread: await api('thread', { path }), selPath: path, view: 'thread', followup: '' })
        } catch (err) { set({ error: '读取失败：' + ((err && err.message) || String(err)) }) }
      }, [])
      const onAsk = React.useCallback(async () => {
        const cur = stRef.current
        set({ asking: true, error: '' })
        try {
          const p = cur.picked
          const r = await api('ask', {
            question: cur.q, text: '', origin: p ? p.origin : '（未标注来源）',
            module: cur.f.module, lesson: cur.f.lesson, type: cur.f.type, severity: cur.f.severity,
            source: p && p.kind === 'region' ? '阅读器框选图区' : '阅读器拖选文字',
          })
          set({ asking: false, q: '', picked: null, notice: '已归档 #' + r.id + '：' + r.title })
          await loadThreads()
          set({ usage: await api('usage', {}) })
          if (r.path) await openThread(r.path)
        } catch (err) { set({ asking: false, error: '提问失败：' + ((err && err.message) || String(err)) }) }
      }, [loadThreads, openThread])
      const onFollowup = React.useCallback(async (path, q) => {
        set({ asking: true, error: '' })
        try {
          const r = await api('followup', { path, question: q })
          set({ asking: false, followup: '', notice: '第 ' + r.turns + ' 轮追问已作答' })
          await openThread(path)
          set({ usage: await api('usage', {}) })
        } catch (err) { set({ asking: false, error: '追问失败：' + ((err && err.message) || String(err)) }) }
      }, [openThread])
      const onGrade = React.useCallback(async () => {
        const cur = stRef.current
        set({ busy: true, error: '', hwResult: null })
        try {
          const s = await api('submission.save', { lesson: '课时' + cur.hwLesson, name: cur.hwName, text: cur.hwText })
          const m = ((cur.tree && cur.tree.modules) || []).find((mm) => (mm.lessons || []).some((l) => String(l.no) === String(cur.hwLesson)))
          const g = await api('submission.grade', { path: s.rel, lesson: Number(cur.hwLesson), module: m ? m.name : '模块一' })
          set({ busy: false, hwResult: g })
          await loadThreads()
          set({ usage: await api('usage', {}) })
        } catch (err) { set({ busy: false, error: '批改失败：' + ((err && err.message) || String(err)) }) }
      }, [loadThreads])

      React.useEffect(() => { load() }, [load])
      React.useEffect(() => { loadKatex({ onDone: (ok, err) => set(ok ? { katexReady: true } : { katexError: err || '未知' }) }) }, [])

      const views = [
        { id: 'chapter', label: '章节' },
        { id: 'slides', label: '课件' },
        { id: 'threads', label: '我的提问' },
        { id: 'homework', label: '作业批改' },
        { id: 'usage', label: '额度' },
      ]
      return h('div', { className: 'k22' },
        h('div', { className: 'k23' },
          h('div', null,
            h('div', { className: 'k9a' },
              h('div', { className: 'k10' }, '课程问题池'),
              h('span', { className: 'k9b', 'data-role': 'student', title: '学生端：提问费用记在你自己账号上；你的问题默认只属于你，老师审核后才可能公开给全班' }, '学生'),
              st.info && st.info.student ? h('span', { className: 'k9c' }, st.info.student) : null),
            h('div', { className: 'k41' }, st.info
              ? ('我的 ' + ((st.mine || []).length) + ' 条 · 公开 ' + ((st.publicItems || []).length) + ' 条 · 课件 ' + (st.slides ? st.slides.slideCount : 0) + ' 页' + (st.katexReady ? ' · 公式已就绪' : ''))
              : '加载中…')),
          h('div', { className: 'k54' }),
          h('div', { className: 'k24' }, views.map((v) => h('span', {
            key: v.id, className: 'k43', 'data-on': (st.view === v.id || (v.id === 'threads' && st.view === 'thread')) ? '1' : '0',
            onClick: () => set({ view: v.id }),
          }, v.label))),
          h('button', { className: 'k42', disabled: st.busy, onClick: load }, st.busy ? '处理中…' : '刷新')),
        st.error ? h('div', { className: 'k52 k53', style: { margin: '8px 14px 0' } }, st.error) : null,
        st.notice ? h('div', { className: 'k52 k62', style: { margin: '8px 14px 0' } }, st.notice) : null,
        st.katexError ? h('div', { className: 'k52 k53', style: { margin: '8px 14px 0' } }, '公式渲染不可用：' + st.katexError) : null,
        h('div', { className: 'k25' },
          h('div', { className: 'k44 k26' },
            h('div', { className: 'k64' }, '章节'),
            h('div', { className: 'k70' }, ((st.info && st.info.chapters) || ['第一章']).map((ch) => h('span', {
              key: ch, className: 'k71', 'data-on': st.chapter === ch ? '1' : '0', onClick: () => switchChapter(ch),
            }, ch))),
            h('div', { className: 'k64' }, '课时脉络'),
            h('div', { className: 'k1' }, st.tree ? h(Fishbone, {
              tree: st.tree, selected: Number(st.hwLesson) || 0,
              onPick: (ls) => set({ hwLesson: String(ls.no), view: 'homework' }),
            }) : h('div', { className: 'k21' }, '索引加载中…'))),
          h('div', { className: 'k27' },
            st.view === 'chapter' ? h('div', { className: 'k46' },
              h('div', { className: 'k64' }, '从这里开始'),
              h('div', { className: 'k57' }, '① 「课件」里框选一块（公式/截图）→ 提交提问；② 「我的提问」里看完整多轮问答并继续追问；③ 「作业批改」按教案初筛；④ 「额度」看你花了多少 token。'),
              h('div', { className: 'k57' }, '你的问题默认只有你能看到。老师审核后，会把值得全班看的那些放进公共池 —— 这样能避免个别问题占用所有人的注意力。')) : null,
            st.view === 'slides' ? h('div', null, h(Slides, { st, set }), h(AskBar, { st, set, onAsk })) : null,
            st.view === 'threads' ? h(ThreadList, { st, set, onOpen: openThread }) : null,
            st.view === 'thread' ? h(ThreadView, { st, set, onFollowup }) : null,
            st.view === 'homework' ? h(Homework, { st, set, onGrade }) : null,
            st.view === 'usage' ? h(Usage, { st }) : null)))
    }

    const inject = ['slots', 'timer']
    function apply(ctx) {
      const disposers = []
      ensureCss()
      try {
        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 41, label: '课程问题池（学生）',
        }, (props) => h(StuIcon, props))))
      } catch (error) { console.error('[cip-stu] 侧栏注册抛错', error) }
      try {
        disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, () => h(Panel, {}))))
      } catch (error) { console.error('[cip-stu] 主面板注册抛错', error) }
      ctx.effect(() => () => {
        for (const d of disposers) { try { d() } catch (error) { console.error('[cip-stu] dispose failed', error) } }
      }, 'course-student cleanup')
      console.log('[cip-stu] client apply 完毕（v1）')
    }

    exports.name = 'course-panel-student'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
