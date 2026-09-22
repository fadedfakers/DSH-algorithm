window.__ModuleLoader__.load({
  id: "dsh-course-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // 正式客户端包里 React 不是全局（动态沙箱才注入），必须显式 require。
    // 对照：dsh-market 与 dsh-better-sidebar 的 lib/client.js 都是 require("react")。
    const React = require('react')
    // client 与 v13 相同（瑕疵均在 host 侧）。
    const PANEL_ID = 'course-issues'
    const AI_LABEL = 'AI 答复'
    const THREAD_LABEL = '追问记录'
    const GRADE_LABEL = '作业批改'
    const MODULES = ['模块一', '模块二', '模块三', '模块四', '模块五']
    const TYPES = ['概念问题', '代码报错', '环境问题', '数值稳定性', '作业疑问', '讲义问题', '内容建议']
    const SEVERITIES = ['阻塞', '高', '中', '低']
    const STATUS_COLOR = {
      待处理: 'var(--dsw-alias-state-warn-primary)', 已答复: 'var(--dsw-alias-brand-primary)',
      待复盘: '#c2410c', 已沉淀: 'var(--dsw-alias-state-success-primary)', 转教案修订: '#7c3aed',
    }
    const SEVERITY_COLOR = {
      阻塞: 'var(--dsw-alias-state-error-primary)', 高: 'var(--dsw-alias-state-warn-primary)',
      中: 'var(--dsw-alias-label-secondary)', 低: 'var(--dsw-alias-label-secondary)',
    }
    const FLOW = ['待处理', '已答复', '待复盘', '已沉淀', '转教案修订']
    const SECTIONS = ['原始提问', '现象', '初步判断', AI_LABEL, '处理结论', '复盘']
    const NL = String.fromCharCode(10)
    const ZOOM_MIN = 0.4
    const ZOOM_MAX = 4
    const KATEX_BASE = '/cip-katex'
    const CSS_URL = '/cip-panel.css'
    const CSS_ID = 'cip-panel-css'
    const FISH_COLORS = ['#4c8dff', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6']
    
    function ensureCss() {
      if (document.getElementById(CSS_ID)) return
      const l = document.createElement('link')
      l.id = CSS_ID
      l.rel = 'stylesheet'
      l.href = CSS_URL
      document.head.appendChild(l)
    }
    
    function css(text) {
      const out = {}
      for (const part of String(text || '').split(';')) {
        const i = part.indexOf(':')
        if (i < 0) continue
        const k = part.slice(0, i).trim()
        const v = part.slice(i + 1).trim()
        if (!k || !v) continue
        out[k.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v
      }
      return out
    }
    function h(type, props) {
      const children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [type, props].concat(children))
    }
    function bdg(t, c, g) { return h('span', g ? { className: 'k50 k19' } : { className: 'k50', style: { background: c } }, t) }
    function pick(options, value, onChange) {
      return h('select', { className: 'k61', value: value, onChange: (e) => onChange(e.target.value) },
        options.map((o) => h('option', { key: o, value: o }, o)))
    }
    
    function RailIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v9A1.5 1.5 0 0 1 19.5 16h-6.2l-4.3 4v-4H4.5A1.5 1.5 0 0 1 3 14.5v-9Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('circle', { cx: 8.6, cy: 10, r: 1.05, fill: 'currentColor' }),
        h('circle', { cx: 12.2, cy: 10, r: 1.05, fill: 'currentColor' }),
        h('circle', { cx: 15.8, cy: 10, r: 1.05, fill: 'currentColor' }),
        h('path', { d: 'M15.4 3.2h5.4v5.1', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    
    const katexState = { ready: false, error: '', loading: false, queued: [] }
    function loadKatex(hooks) {
      if (katexState.ready) { hooks.onDone(true, ''); return }
      katexState.queued.push(hooks)
      if (katexState.loading) return
      katexState.loading = true
      const flush = (ok, err) => {
        katexState.loading = false
        katexState.ready = ok
        katexState.error = err || ''
        const list = katexState.queued.slice()
        katexState.queued = []
        for (const x of list) { try { x.onDone(ok, err) } catch (e) { /* ignore */ } }
      }
      try {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = KATEX_BASE + '/katex.min.css'
        document.head.appendChild(link)
        const s = document.createElement('script')
        s.src = KATEX_BASE + '/katex.min.js'
        s.onload = () => flush(true, '')
        s.onerror = () => flush(false, 'KaTeX 脚本加载失败')
        document.head.appendChild(s)
      } catch (e) { flush(false, '注入 KaTeX 失败：' + (e && e.message ? e.message : String(e))) }
    }
    
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }
    function maskMath(text, store) {
      let out = String(text == null ? '' : text)
      const put = (tex, display) => { const key = '\u0000M' + store.length + '\u0000'; store.push({ tex: tex, display: display }); return key }
      out = out.replace(/\$\$([\s\S]+?)\$\$/g, (m, g) => put(g, true))
      out = out.replace(/\\\[([\s\S]+?)\\\]/g, (m, g) => put(g, true))
      out = out.replace(/\\\(([\s\S]+?)\\\)/g, (m, g) => put(g, false))
      out = out.replace(/\$([^$\n]+?)\$/g, (m, g) => put(g, false))
      return out
    }
    function escapeExceptPlaceholders(masked) {
      return String(masked).split(/(\u0000M\d+\u0000)/)
        .map((p) => (/^\u0000M\d+\u0000$/.test(p) ? p : esc(p))).join('')
    }
    function renderMathIn(htmlEscaped, store) {
      return htmlEscaped.replace(/\u0000M(\d+)\u0000/g, (m, i) => {
        const item = store[Number(i)]
        if (!item) return ''
        if (!katexState.ready || typeof window.katex === 'undefined' || !window.katex.renderToString) {
          return item.display ? ('<pre>' + esc(item.tex) + '</pre>') : ('<code>' + esc(item.tex) + '</code>')
        }
        try {
          return window.katex.renderToString(item.tex, { displayMode: item.display, throwOnError: false, output: 'htmlAndMathml' })
        } catch (e) { return '<code>' + esc(item.tex) + '</code>' }
      })
    }
    function markdownToHtml(src) {
      const store = []
      const masked = maskMath(src, store)
      const lines = masked.replace(/\r\n/g, '\n').split('\n')
      const out = []
      let i = 0
      const inline = (s) => {
        let x = escapeExceptPlaceholders(s)
        x = x.replace(/`([^`]+?)`/g, (m, g) => '<code>' + g + '</code>')
        x = x.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        x = x.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
        x = x.replace(/\*([^*]+?)\*/g, '<em>$1</em>')
        return x
      }
      const flushP = (buf) => { if (buf.length) { out.push('<p>' + buf.map(inline).join('<br/>') + '</p>'); buf.length = 0 } }
      const para = []
      while (i < lines.length) {
        const line = lines[i]
        if (/^\s*```/.test(line)) {
          flushP(para)
          const body = []
          i += 1
          while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i += 1 }
          i += 1
          out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>')
          continue
        }
        const hd = /^(#{1,6})\s+(.*)$/.exec(line)
        if (hd) { flushP(para); const lv = hd[1].length; out.push('<h' + lv + '>' + inline(hd[2]) + '</h' + lv + '>'); i += 1; continue }
        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushP(para); out.push('<hr/>'); i += 1; continue }
        if (/^\s*[-*+]\s+/.test(line)) {
          flushP(para)
          const items = []
          while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'); i += 1 }
          out.push('<ul>' + items.join('') + '</ul>')
          continue
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
          flushP(para)
          const items = []
          while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push('<li>' + inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'); i += 1 }
          out.push('<ol>' + items.join('') + '</ol>')
          continue
        }
        if (/^\s*>\s?/.test(line)) {
          flushP(para)
          const body = []
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i += 1 }
          out.push('<blockquote>' + inline(body.join(' ')) + '</blockquote>')
          continue
        }
        if (!line.trim()) { flushP(para); i += 1; continue }
        para.push(line)
        i += 1
      }
      flushP(para)
      return renderMathIn(out.join(''), store)
    }
    function Markdown({ text }) {
      return h('div', { className: 'k63', dangerouslySetInnerHTML: { __html: markdownToHtml(text || '') } })
    }
    
    function ChapterView({ st, set, onSwitch, onPick }) {
      const mods = st.tree && st.tree.modules ? st.tree.modules : []
      const chapters = st.info && st.info.chapters ? st.info.chapters : []
      return h('div', { className: 'k72' },
        h('div', { className: 'k57', style: { marginBottom: '8px' } },
          '当前章节：' + (st.chapter || '?') + '（共 ' + (st.slides ? st.slides.slideCount : 0) + ' 页）。先选章节，再点课时进入作业批改。'),
        h('div' , { className: 'k70' }, chapters.map((ch) => h('span', {
          key: ch, className: 'k71', 'data-on': st.chapter === ch ? '1' : '0', onClick: () => onSwitch(ch),
        }, ch))),
        h('div', { className: 'k64' }, '本章课时'),
        mods.length ? mods.map((mod, mi) => h('div', { key: 'm' + mi },
          h('div', { className: 'k73', 'data-on': '0' },
            h('span', { className: 'k74', style: { background: FISH_COLORS[mi % FISH_COLORS.length] } }),
            h('div', null,
              h('div', { className: 'k75' }, mod.name + ' · ' + mod.range),
              h('div', { className: 'k76' }, mod.theme))),
          h('div', { className: 'k77' }, mod.lessons.map((ls, li) => h('div', {
            key: 'l' + mi + '-' + li, className: 'k78', 'data-sel': st.gradeLesson && st.gradeLesson.no === ls.no ? '1' : '0',
            onClick: () => onPick(ls, mod),
            title: 'L' + ls.no + ' ' + ls.title + (ls.hasPlan ? '' : '（教案未撰写）'),
          }, h('span', null, 'L' + ls.no + ' ' + ls.short), ls.hasPlan ? null : h('span', { className: 'k30' }))))))
          : h('div', { className: 'k21' }, '课程结构索引未加载'))
    }
    
    function Fishbone({ tree, onPick, selected }) {
      if (!tree || !tree.modules) return h('div', { className: 'k21' }, '课程索引未加载')
      const mods = tree.modules
      const nodes = []
      nodes.push(h('div', { key: 'hd', className: 'k57', style: { marginBottom: '6px' } },
        '共 ' + tree.totalLessons + ' 课时 · 点课时进入作业批改'))
      mods.forEach((mod, mi) => {
        const color = FISH_COLORS[mi % FISH_COLORS.length]
        nodes.push(h('div', { key: 'mh' + mi, style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0 3px' } },
          h('span', { className: 'k74', style: { background: color, marginTop: 0 } }),
          h('span', { style: { color: color, fontWeight: 700, fontSize: '12px' } }, mod.name),
          h('span', { className: 'k57', style: { marginLeft: 'auto' } }, mod.range)))
        nodes.push(h('div', { key: 'ml' + mi, className: 'k57', style: { marginLeft: '15px', marginBottom: '3px' } }, mod.theme))
        nodes.push(h('div', { key: 'lg' + mi, className: 'k77' },
          mod.lessons.map((ls, li) => {
            const isSel = selected === ls.no
            return h('div', {
              key: 'l' + mi + '-' + li, className: 'k78', 'data-sel': isSel ? '1' : '0',
              title: 'L' + ls.no + ' ' + ls.title + (ls.hasPlan ? '' : '（教案未撰写）') + ((ls.knowledge && ls.knowledge.length) ? ('｜' + ls.knowledge.join(' / ')) : ''),
              onClick: () => onPick(ls, mod),
            },
              h('span', null, 'L' + ls.no + ' ' + ls.short),
              ls.hasPlan ? null : h('span', { className: 'k30' }))
          })))
      })
      return h('div', null, nodes)
    }
    
    async function exportRegion(wrapEl, slideData, box) {
      const diag = { imgs: 0, media: 0, pairs: 0, drawn: 0, failed: 0, reason: '' }
      if (!wrapEl) { diag.reason = 'wrapper 为空'; return { dataUrl: null, diag: diag } }
      const slideEl = wrapEl.querySelector('div')
      if (!slideEl) { diag.reason = '未找到幻灯片节点'; return { dataUrl: null, diag: diag } }
      const imgs = Array.prototype.slice.call(slideEl.querySelectorAll('img'))
      const media = (slideData.media || []).filter((m) => m.file)
      diag.imgs = imgs.length; diag.media = media.length
      const pairs = []
      for (let i = 0; i < imgs.length && i < media.length; i += 1) pairs.push({ img: imgs[i], m: media[i] })
      diag.pairs = pairs.length
      if (!pairs.length) { diag.reason = '本页无已加载图片'; return { dataUrl: null, diag: diag } }
      for (const p of pairs) if (!p.img.complete) await new Promise((r) => { p.img.onload = r; p.img.onerror = r })
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(box.w * scale))
      canvas.height = Math.max(1, Math.round(box.h * scale))
      const g = canvas.getContext('2d')
      if (!g) { diag.reason = '无法获取 2d 上下文'; return { dataUrl: null, diag: diag } }
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height)
      for (const p of pairs) {
        if (!p.img.naturalWidth) { diag.failed += 1; continue }
        try { g.drawImage(p.img, (p.m.x - box.x) * scale, (p.m.y - box.y) * scale, p.m.w * scale, p.m.h * scale); diag.drawn += 1 }
        catch (e) { diag.failed += 1 }
      }
      if (!diag.drawn) { diag.reason = '所有图片均未能画入画布'; return { dataUrl: null, diag: diag } }
      try { return { dataUrl: canvas.toDataURL('image/png'), diag: diag } }
      catch (e) { diag.reason = 'canvas 被跨源污染'; return { dataUrl: null, diag: diag } }
    }
    
    function SlideView({ st, set }) {
      const slides = st.slides
      const wrapRef = React.useRef(null)
      const mode = st.mode
      const zoom = st.zoom || 1
      const total = slides && slides.slides ? slides.slides.length : 0
      const idx = total ? Math.max(0, Math.min(st.slideIndex, total - 1)) : 0
      const zoomRef = React.useRef(zoom)
      zoomRef.current = zoom
      React.useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap || !slides) return undefined
        const onWheel = (ev) => {
          if (!(ev.button === 1 || ev.ctrlKey || ev.metaKey)) return
          ev.preventDefault()
          const factor = ev.deltaY < 0 ? 1.15 : (1 / 1.15)
          set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (zoomRef.current || 1) * factor)) })
        }
        const onDown = (ev) => { if (ev.button === 1) ev.preventDefault() }
        wrap.addEventListener('wheel', onWheel, { passive: false })
        wrap.addEventListener('mousedown', onDown)
        return () => { wrap.removeEventListener('wheel', onWheel); wrap.removeEventListener('mousedown', onDown) }
      }, [slides, set])
      React.useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap || !slides || mode !== 'region') return undefined
        const slideEl = wrap.querySelector('div')
        if (!slideEl) return undefined
        const local = (ev) => {
          const r = slideEl.getBoundingClientRect()
          const k = r.width / slides.slideWidth
          return { x: Math.max(0, Math.min(slides.slideWidth, (ev.clientX - r.left) / k)), y: Math.max(0, Math.min(slides.slideHeight, (ev.clientY - r.top) / k)) }
        }
        const down = (ev) => {
          if (ev.button === 1) return
          ev.preventDefault()
          const start = local(ev)
          const move = (e2) => {
            const cur = local(e2)
            set({ box: { x: Math.round(Math.min(start.x, cur.x)), y: Math.round(Math.min(start.y, cur.y)), w: Math.round(Math.abs(cur.x - start.x)), h: Math.round(Math.abs(cur.y - start.y)) } })
          }
          const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
          document.addEventListener('mousemove', move)
          document.addEventListener('mouseup', up)
        }
        slideEl.addEventListener('mousedown', down)
        return () => slideEl.removeEventListener('mousedown', down)
      }, [idx, mode, slides, set])
      if (!slides || !slides.slides || !slides.slides.length) {
        return h('div', { className: 'k21' }, '未找到幻灯片数据。请先运行 课程中心\\tools\\extract_pptx.py，再点「刷新」。')
      }
      const slide = slides.slides[idx]
      if (!slide || !slide.shapes || !slide.media) return h('div', { className: 'k21' }, '第 ' + (idx + 1) + ' 页数据不完整（共 ' + total + ' 页），已跳过渲染。请点「刷新」重试。')
      const W = slides.slideWidth
      const H = slides.slideHeight
      return h('div', { className: 'k16' },
        h('div', { className: 'k18' },
          h('button', { className: 'k42', onClick: () => set({ slideIndex: Math.max(0, idx - 1), box: null }) }, '← 上一页'),
          h('span', null, '第 ' + slide.index + ' / ' + total + ' 页'),
          h('button', { className: 'k42', onClick: () => set({ slideIndex: Math.min(total - 1, idx + 1), box: null }) }, '下一页 →'),
          h('button', { className: 'k42', onClick: () => set({ zoom: 1 }) }, '缩放 ' + Math.round(zoom * 100) + '%'),
          h('button', { className: 'k42', onClick: () => set({ zoom: Math.min(ZOOM_MAX, zoom * 1.25) }) }, '＋'),
          h('button', { className: 'k42', onClick: () => set({ zoom: Math.max(ZOOM_MIN, zoom / 1.25) }) }, '－'),
          h('span', null, mode === 'region' ? '拖框选图区；中键滚轮缩放' : '选中文字后点浮出的按钮')),
        h('div', { ref: wrapRef, className: 'k0', style: { width: (W * zoom) + 'px', height: (H * zoom) + 'px' } },
          h('div', { className: 'k17', style: { width: W + 'px', height: H + 'px', transform: 'scale(' + zoom + ')', transformOrigin: '0 0' } },
            slide.shapes.map((s, i) => h('div', {
              key: 's' + i, className: 'k47',
              style: css('left:' + s.x + 'px;top:' + s.y + 'px;width:' + s.w + 'px;height:' + s.h + 'px;font-size:' + (s.maxPt ? Math.max(9, Math.min(30, s.maxPt * 0.92)) : 13) + 'px;font-weight:' + (s.bold ? 600 : 400) + ';'),
            }, s.text)),
            slide.media.map((m, i) => {
              const bs = css('left:' + m.x + 'px;top:' + m.y + 'px;width:' + m.w + 'px;height:' + m.h + 'px;')
              if (!m.file) return h('div', { key: 'm' + i, className: 'k55', style: bs }, h('b', null, m.kind === 'video' ? '视频未内联' : '图片不可用'), h('span', null, m.name))
              // 媒体路由在这里拼。宿主返回的 m.file 是 JSON 里的**裸文件名**
              // （宿主曾经自己拼前缀，导致双前缀 + 400，全部图片加载不出来）。
              const src = CIP_MEDIA + '/' + encodeURIComponent(st.chapter || '') + '/' + encodeURIComponent(m.file)
              return h(MediaImage, { key: 'm' + i, src: src, name: m.name, boxStyle: bs, st: st, set: set })
            }),
            mode === 'region' ? h('div', { className: 'k31' }) : null,
            st.box ? h('div', { className: 'k48', style: css('left:' + st.box.x + 'px;top:' + st.box.y + 'px;width:' + st.box.w + 'px;height:' + st.box.h + 'px;') }) : null,
            st.box ? h('button', { className: 'k32', style: css('left:' + st.box.x + 'px;top:' + Math.max(2, st.box.y + st.box.h + 6) + 'px;'), onClick: () => st.onRegion(st.box, slide, wrapRef.current) }, '就这块提问') : null)))
    }
    
    function MediaImage({ src, name, boxStyle, st, set }) {
      const failed = st.brokenMedia && st.brokenMedia[name]
      if (failed) return h('div', { className: 'k55', style: boxStyle, title: failed }, h('b', null, '加载失败'), h('span', null, name))
      return h('img', { src: src, alt: name, style: boxStyle, onError: () => {
        const next = Object.assign({}, st.brokenMedia || {}); next[name] = '加载失败'; set({ brokenMedia: next })
      } })
    }
    
    function DocView({ st }) {
      const doc = st.docRef
      if (!doc) return h('div', { className: 'k21' }, '从左侧选一份材料。')
      return h('div', { className: 'k2' }, doc.text)
    }
    
    function GradeView({ st, set }) {
      const ls = st.gradeLesson
      const subs = st.submissions || []
      const cur = st.gradeCurrent
      const onFile = (ev) => {
        const f = ev.target.files && ev.target.files[0]
        if (!f) return
        if (f.size > 4 * 1024 * 1024) { set({ error: '文件过大（上限 4MB）：' + f.name }); return }
        const fr = new FileReader()
        fr.onload = () => set({ pendingFile: { name: f.name, text: String(fr.result || ''), bytes: f.size } })
        fr.onerror = () => set({ error: '读取文件失败：' + f.name })
        fr.readAsText(f, 'utf-8')
      }
      const head = h('div', { className: 'k18' },
        h('span', null, ls ? ('正在批改：L' + ls.no + ' ' + ls.title) : '从左侧鱼骨图点一个课时（黄点 = 教案未撰写）'),
        h('button', { className: 'k42', onClick: () => set({ gradeLesson: null, gradeCurrent: null, pendingFile: null, submissions: [], gradeResult: '', gradeTrace: null }) }, '清空'))
      const drop = ls ? h('div', { className: 'k40' },
        h('div', null, '把学生提交的代码文件放进来（只收文本类，上限 4MB）'),
        h('input', { type: 'file', accept: '.py,.ipynb,.md,.txt,.yaml,.yml,.json,.csv,.tsv', title: '不收 .pth/.pt/.ckpt/.onnx 等模型权重（二进制大文件，请走共享盘）', style: { marginTop: '7px' }, onChange: onFile }),
        st.pendingFile ? h('div', { style: { marginTop: '7px' } },
          h('div', null, '已选：' + st.pendingFile.name + '（' + st.pendingFile.bytes + ' 字节）'),
          h('button', { className: 'k42 k11', style: { marginTop: '5px' }, disabled: st.busy, onClick: () => st.onSaveSub() }, st.busy ? '保存中…' : '存入 作业提交/L' + ls.no + '/')) : null) : null
      const list = h('div', null,
        h('div', { className: 'k64' }, '本课时提交（' + subs.length + '）'),
        subs.length ? subs.map((f) => h('div', { key: f.path, className: 'k33', 'data-sel': cur && cur.path === f.path ? '1' : '0', onClick: () => st.onOpenSub(f.path) },
          h('div', { className: 'k56' }, f.name),
          h('div', { className: 'k57' }, Math.round(f.size / 1024) + ' KB' + (f.graded ? ' · 已批改' : ''))))
          : h('div', { className: 'k21' }, ls ? '这个课时还没有提交。' : '先选一个课时。'))
      const detail = cur ? h('div', { style: { marginTop: '12px' } },
        h('div', { className: 'k64' }, cur.name),
        h('pre', { className: 'k39' }, cur.text),
        h('div', { className: 'k36' },
          h('button', { className: 'k42 k11', disabled: st.busy, onClick: () => st.onGrade(cur.path) }, st.busy ? 'AI 批改中…' : '按教案批改')),
        st.gradeResult ? h('div', { className: 'k51' },
          h('div', { className: 'k58' }, GRADE_LABEL, bdg('AI 草稿·待老师确认', '#7c3aed')),
          h('div', { className: 'k59' }, h(Markdown, { text: st.gradeResult }))) : null,
        st.gradeTrace ? h('div', { className: 'k35' }, '【批改诊断】' + st.gradeTrace.join(NL)) : null) : null
      return h('div', { style: { padding: '12px' } }, head, drop, list, detail)
    }
    
    function IssueListView({ st, set }) {
      const items = st.items || []
      const f = st.filters
      const vis = items.filter((it) => {
        if (f.status && it.status !== f.status) return false
        if (f.module && it.module !== f.module) return false
        if (f.q) {
          const hay = [it.title, it.excerpt, it.lesson, it.module].join(' ').toLowerCase()
          if (hay.indexOf(f.q.toLowerCase()) < 0) return false
        }
        return true
      })
      return h('div', { style: { padding: '11px' } },
        h('div', { className: 'k18' },
          h('input', { className: 'k61', placeholder: '搜索标题/课时', value: f.q, style: { maxWidth: '220px' }, onChange: (e) => set({ filters: Object.assign({}, f, { q: e.target.value }) }) }),
          h('button', { className: 'k42', onClick: () => set({ filters: { q: '', module: null, status: null } }) }, '清空')),
        h('div', { className: 'k20' }, Object.keys(STATUS_COLOR).map((s) => h('span', { key: s, className: 'k37', 'data-cur': f.status === s ? '1' : '0', onClick: () => set({ filters: Object.assign({}, f, { status: f.status === s ? null : s }) }) }, s))),
        h('div', { style: { marginTop: '9px' } }, vis.length
          ? vis.map((it) => h('div', { key: it.path, className: 'k33', 'data-sel': st.selPath === it.path ? '1' : '0', onClick: () => st.onOpenIssue(it.path) },
            h('div', null, bdg(it.status || '?', STATUS_COLOR[it.status] || 'var(--dsw-alias-label-secondary)'),
              it.severity ? bdg(it.severity, SEVERITY_COLOR[it.severity]) : null,
              it.threadCount ? bdg('追问 ' + it.threadCount, '#0ea5e9') : null),
            h('div', { className: 'k56' }, '#' + it.id + ' ' + it.title),
            h('div', { className: 'k57' }, [it.module, it.lesson, it.source].filter(Boolean).join(' · '))))
          : h('div', { className: 'k21' }, '没有匹配的问题。')))
    }
    
    function Detail({ st, set }) {
      const canAudit = !st.info || st.info.canAudit !== false
      const it = (st.items || []).find((x) => x.path === st.selPath)
      if (!it) return h('div', { className: 'k21' }, '从左侧选一条问题，或从课件/教案里框选提问。')
      const secs = st.detailSections || {}
      const thread = st.detailThread || []
      const msg = st.lastRun && st.lastRun.path === it.path ? st.lastRun : null
      return h('div', null,
        h('div', null, bdg(it.status || '?', STATUS_COLOR[it.status] || 'var(--dsw-alias-label-secondary)'),
          it.severity ? bdg(it.severity, SEVERITY_COLOR[it.severity]) : null,
          it.type ? bdg(it.type, null, true) : null),
        h('div', { style: { fontSize: '14px', fontWeight: 600, margin: '5px 0 3px', wordBreak: 'break-word' } }, '#' + it.id + ' ' + it.title),
        h('div', { className: 'k57', style: { marginBottom: '9px', wordBreak: 'break-all' } }, [it.module, it.lesson, it.source, it.reporter].filter(Boolean).join(' · ')),
        msg ? h('div', { className: 'k35' }, '【链路诊断】' + (msg.trace || []).join(NL)) : null,
        st.katexError ? h('div', { className: 'k52 k53' }, '公式渲染不可用：' + st.katexError) : null,
        h('div', { className: 'k20' }, FLOW.map((s) => h('span', { key: s, className: 'k37', 'data-cur': it.status === s ? '1' : '0', onClick: () => st.onAdvance(it.path, s) }, s))),
        SECTIONS.map((t) => {
          const txt = secs[t] || ''
          const empty = !txt.trim() || txt.trim() === '（待补充）'
          return h('div', { key: t, className: 'k51' },
            h('div', { className: 'k58' }, t, t === AI_LABEL ? bdg('AI 草稿·待老师确认', '#7c3aed') : null, empty ? bdg('待补充', null, true) : null),
            h('div', { className: 'k59', 'data-empty': empty ? '1' : '0', 'data-ai': t === AI_LABEL ? '1' : '0' }, empty ? '（待补充）' : h(Markdown, { text: txt })))
        }),
        thread.length ? h('div', { className: 'k51' },
          h('div', { className: 'k58' }, THREAD_LABEL, bdg('多轮追问', '#0ea5e9')),
          h('div', { className: 'k59' }, thread.map((t, i) => h('div', { key: 't' + i, className: 'k38' },
            h('div', { className: 'k7' }, 'Q' + (i + 1) + '：' + t.q),
            h('div', { className: 'k8' }, h(Markdown, { text: t.a })))))) : null,
        h('div', { className: 'k51' },
          h('div', { className: 'k58' }, '继续追问'),
          h('div', { className: 'k59' },
            h('div', { className: 'k65' }, h('textarea', { className: 'k60', value: st.followUp || '', placeholder: '接着问。前面的对话会一并带给 AI，可以直接说「那为什么…」', onChange: (e) => set({ followUp: e.target.value }) })),
            h('button', { className: 'k42 k11', style: { width: '100%' }, disabled: st.asking || !(st.followUp || '').trim(), onClick: () => st.onFollowUp(it.path) }, st.asking ? 'AI 正在作答…' : '追问（带上前文）'),
            h('div', { className: 'k57', style: { marginTop: '6px' } }, '已记录 ' + thread.length + ' 轮追问。'))),
        h('div', { className: 'k36' },
          h('button', { className: 'k42', onClick: () => st.onSave(it.path, secs) }, '保存修改'),
          h('button', { className: 'k42', disabled: st.asking, onClick: () => st.onRerunAi(it.path) }, st.asking ? 'AI 作答中…' : '重答首问'),
          h('button', { className: 'k42', onClick: () => st.onAdvance(it.path, '已答复') }, '标记已答复'),
          h('button', { className: 'k42', onClick: () => st.onAdvance(it.path, '已沉淀') }, '标记已沉淀'),
          canAudit ? h('button', { className: 'k42 k11', title: '进入公共 FAQ，下次发布带给全班', onClick: () => st.onAudit(it.path, 'shared') }, '值得共享') : null,
          canAudit ? h('button', { className: 'k42', title: '只答提问人本人，不进公共池', onClick: () => st.onAudit(it.path, 'private') }, '只答本人') : null))
    }
    
    function AskPanel({ st, set }) {
      const p = st.picked
      if (!p) {
        return h('div', null,
          h('div', { className: 'k21' }, '在中间的内容上指一段试试：'),
          h('div', { className: 'k57', style: { padding: '0 6px', lineHeight: 1.9 } },
            '· 课件页：保持「框选图区」，把公式或截图框起来', h('br'),
            '· 教案页：切到「拖选文字」，选中一段文字', h('br'),
            '· 中键滚轮或 Ctrl+滚轮可以缩放课件', h('br'),
            '· 作业页：点鱼骨图上的课时 → 上传学生代码 → 按教案批改'))
      }
      return h('div', null,
        h('div', { className: 'k6' },
          h('div', { className: 'k57' }, '选中内容 · ' + p.origin),
          p.dataUrl ? h('div', { className: 'k3' }, h('img', { className: 'k34', src: p.dataUrl, alt: '框选截图' })) : h('div', { className: 'k57', style: { marginTop: '4px' } }, '（未能导出图像像素）'),
          p.exportDiag ? h('div', { className: 'k35' }, '【截图导出】' + JSON.stringify(p.exportDiag)) : null,
          p.kind === 'text' ? h('div', { style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, p.text.slice(0, 400)) : null),
        h('div', { className: 'k65' }, h('label', null, '你想问什么（可留空，默认问「这块是什么意思」）'),
          h('textarea', { className: 'k60', value: st.q, placeholder: '例如：这个公式为什么这样写？', onChange: (e) => set({ q: e.target.value }) })),
        h('div', { className: 'k66' },
          h('div', { className: 'k65' }, h('label', null, '模块'), pick(MODULES, st.f.module, (v) => set({ f: Object.assign({}, st.f, { module: v }) }))),
          h('div', { className: 'k65' }, h('label', null, '课时'), h('input', { className: 'k61', value: st.f.lesson, onChange: (e) => set({ f: Object.assign({}, st.f, { lesson: e.target.value }) }) })),
          h('div', { className: 'k65' }, h('label', null, '类型'), pick(TYPES, st.f.type, (v) => set({ f: Object.assign({}, st.f, { type: v }) }))),
          h('div', { className: 'k65' }, h('label', null, '严重度'), pick(SEVERITIES, st.f.severity, (v) => set({ f: Object.assign({}, st.f, { severity: v }) })))),
        h('button', { className: 'k42 k11', style: { width: '100%' }, disabled: st.asking, onClick: st.onAsk }, st.asking ? 'AI 正在作答…' : '提问（AI 立即回答并归档）'),
        h('div', { className: 'k57', style: { marginTop: '6px' } }, 'AI 先给答复，同时归档进问题池。'))
    }
    
    function Panel({ timer }) {
      const [st, setSt] = React.useState({
        view: 'ppt', mode: 'region', slideIndex: 0, zoom: 1, chapter: '第二章',
        items: [], docs: [], slides: null, info: null, docRef: null, selPath: '', tree: null,
        detailSections: {}, detailThread: [], error: '', notice: '', busy: false, asking: false,
        filters: { q: '', module: null, status: null },
        picked: null, q: '', followUp: '', box: null, exportNote: '', brokenMedia: {}, lastRun: null,
        katexReady: false, katexError: '',
        gradeLesson: null, submissions: [], gradeCurrent: null, pendingFile: null, gradeResult: '', gradeTrace: null,
        f: { module: '模块二', lesson: '课时7', type: '概念问题', severity: '中' },
      })
      const set = React.useCallback((patch) => setSt((prev) => Object.assign({}, prev, patch)), [])
      const stRef = React.useRef(st)
      stRef.current = st
      React.useEffect(() => {
        loadKatex({ onDone: (ok, err) => { if (ok) set({ katexReady: true, katexError: '' }); else set({ katexError: err || '未知原因' }) } })
      }, [set])
      const timersRef = React.useRef([])
      const clearTimers = React.useCallback(() => {
        const list = timersRef.current; timersRef.current = []
        for (const d of list) { try { d() } catch (e) { /* ignore */ } }
      }, [])
      const later = React.useCallback((fn, ms) => {
        if (!timer || typeof timer.timeout !== 'function') return null
        let disposed = false
        const entry = { d: null }
        const raw = timer.timeout(() => {
          disposed = true
          const i = timersRef.current.indexOf(entry)
          if (i >= 0) timersRef.current.splice(i, 1)
          fn()
        }, ms)
        entry.d = () => { if (!disposed) { disposed = true; try { raw() } catch (e) { /* ignore */ } } }
        timersRef.current.push(entry)
        return entry.d
      }, [timer])
      React.useEffect(() => () => clearTimers(), [clearTimers])
      const loadAll = React.useCallback(async () => {
        set({ busy: true, error: '', brokenMedia: {} })
        try {
          const info = await host.call('pool_info', {})
          const list = await host.call('pool_list', {})
          const docs = await host.call('doc_list', {})
          const slides = await host.call('slides_get', { chapter: stRef.current.chapter })
          const t = await host.call('course_tree', {})
          const notes = []
          if (info && info.mediaOk === false) notes.push('图片不可用：' + (info.mediaError || ''))
          const sc = slides && slides.slides ? slides.slides.length : 0
          const safeIdx = sc ? Math.max(0, Math.min(stRef.current.slideIndex, sc - 1)) : 0
          set({ info: info, items: (list && list.items) || [], docs: (docs && docs.docs) || [], slides: slides, tree: t, slideIndex: safeIdx, busy: false, exportNote: notes.join('；') })
        } catch (err) { set({ error: '加载失败：' + ((err && err.message) || String(err)), busy: false }) }
      }, [set])
      React.useEffect(() => { loadAll() }, [loadAll])
      React.useEffect(() => {
        if (!st.notice) return undefined
        const d = later(() => set({ notice: '' }), 6000)
        return () => { if (d) d() }
      }, [st.notice, later, set])
      const switchChapter = React.useCallback(async (ch) => {
        set({ chapter: ch, slideIndex: 0, box: null, picked: null, view: 'ppt', mode: 'region' })
        stRef.current = Object.assign({}, stRef.current, { chapter: ch })
        await loadAll()
      }, [loadAll, set])
      const loadSubs = React.useCallback(async (no) => {
        try {
          const r = await host.call('submission_list', { lesson: no })
          set({ submissions: (r && r.files) || [], gradeCurrent: null, gradeResult: '', gradeTrace: null, pendingFile: null })
        } catch (err) { set({ error: '提交列表读取失败：' + ((err && err.message) || String(err)) }) }
      }, [set])
      const pickLesson = React.useCallback(async (ls, mod) => {
        set({ gradeLesson: { no: ls.no, title: ls.title, hasPlan: ls.hasPlan, modName: mod ? mod.name : '', knowledge: ls.knowledge || [] }, view: 'grade' })
        await loadSubs(ls.no)
      }, [loadSubs, set])
      const openDoc = React.useCallback(async (d) => {
        try { const full = await host.call('doc_get', { path: d.path }); set({ view: 'doc', mode: 'text', docRef: full, selPath: d.path, box: null }) }
        catch (err) { set({ error: '读取失败：' + ((err && err.message) || String(err)) }) }
      }, [set])
      const openIssue = React.useCallback(async (p, trace) => {
        try {
          const doc = await host.call('pool_read', { path: p })
          const secs = {}
          for (const s of ((doc && doc.sections) || [])) if (s.title !== THREAD_LABEL) secs[s.title] = s.content
          for (const t of SECTIONS) if (secs[t] === undefined) secs[t] = ''
          const patch = { view: 'issue', selPath: p, detailSections: secs, detailThread: (doc && doc.thread) || [] }
          if (trace) patch.lastRun = { path: p, trace: trace }
          set(patch)
        } catch (err) { set({ error: '读取失败：' + ((err && err.message) || String(err)) }) }
      }, [set])
      const advance = React.useCallback(async (p, status) => {
        try { await host.call('pool_update', { path: p, fields: { status: status } }); set({ notice: '已更新为「' + status + '」' }); await loadAll() }
        catch (err) { set({ error: '更新失败：' + ((err && err.message) || String(err)) }) }
      }, [loadAll, set])
      const onAudit = React.useCallback(async (p, decision) => {
        try {
          await host.call('audit_issue', { path: p, decision: decision })
          set({ notice: decision === 'shared' ? '已标为「值得共享」（下次发布带进 FAQ）' : '已标为「只答本人」' })
          await loadAll(); await openIssue(p)
        } catch (err) { set({ error: '审计失败：' + ((err && err.message) || String(err)) }) }
      }, [loadAll, openIssue, set])
      const saveSections = React.useCallback(async (p, secs) => {
        try { await host.call('pool_update', { path: p, sections: secs }); set({ notice: '已写回 Markdown' }); await loadAll() }
        catch (err) { set({ error: '保存失败：' + ((err && err.message) || String(err)) }) }
      }, [loadAll, set])
      const rerunAi = React.useCallback(async (p) => {
        set({ asking: true, error: '' })
        try { const r = await host.call('pool_ai_answer', { path: p }); set({ asking: false, notice: r && r.aiFailed ? ('AI 作答失败：' + (r.aiNote || '')) : 'AI 已重答首问' }); await loadAll(); await openIssue(p) }
        catch (err) { set({ asking: false, error: 'AI 作答失败：' + ((err && err.message) || String(err)) }) }
      }, [loadAll, openIssue, set])
      const onFollowUp = React.useCallback(async (p) => {
        const q = (stRef.current.followUp || '').trim()
        if (!q) return
        set({ asking: true, error: '' })
        try {
          const r = await host.call('pool_followup', { path: p, question: q })
          set({ asking: false, followUp: '', notice: r && r.aiFailed ? ('追问已存档，但 AI 作答失败' + (r.aiNote || '')) : '已记入追问记录' })
          await loadAll(); await openIssue(p)
        } catch (err) { set({ asking: false, error: '追问失败：' + ((err && err.message) || String(err)) }) }
      }, [loadAll, openIssue, set])
      const onRegion = React.useCallback(async (box, slideData, wrapEl) => {
        const origin = '第二章.pptx 第 ' + slideData.index + ' 页 · 区域 (' + box.x + ',' + box.y + ') ' + box.w + '×' + box.h
        const out = await exportRegion(wrapEl, slideData, box)
        const note = out.dataUrl ? ('截图已就绪（约 ' + Math.round(out.dataUrl.length / 1365) + ' KB）') : ('截图未导出：' + (out.diag.reason || '未知'))
        set({ picked: { kind: 'region', box: box, origin: origin, text: '', dataUrl: out.dataUrl, exportDiag: out.diag }, exportNote: note })
      }, [set])
      const onAsk = React.useCallback(async () => {
        const cur = stRef.current
        const p = cur.picked
        if (!p) return
        set({ asking: true, error: '' })
        const trace = ['插件版本 v15']
        try {
          const r = await host.call('pool_ask', { kind: p.kind, origin: p.origin, box: p.box, text: p.text, dataUrl: p.dataUrl, question: cur.q, module: cur.f.module, lesson: cur.f.lesson, type: cur.f.type, severity: cur.f.severity })
          set({ asking: false, picked: null, q: '' })
          if (r && r.trace) for (const t of r.trace) trace.push(t)
          set({ notice: r && r.aiFailed ? ('已归档 #' + r.id + '，AI 失败') : ('已归档 #' + r.id) })
          await loadAll()
          if (r && r.path) await openIssue(r.path, trace)
        } catch (err) { set({ asking: false, error: '提问失败：' + ((err && err.message) || String(err)) }) }
      }, [loadAll, openIssue, set])
      const onSaveSub = React.useCallback(async () => {
        const cur = stRef.current
        if (!cur.pendingFile || !cur.gradeLesson) return
        set({ busy: true, error: '' })
        try {
          const r = await host.call('submission_save', { lesson: cur.gradeLesson.no, name: cur.pendingFile.name, text: cur.pendingFile.text })
          set({ busy: false, pendingFile: null, notice: '已存入 ' + (r && r.rel ? r.rel : '作业提交') })
          await loadSubs(cur.gradeLesson.no)
        } catch (err) { set({ busy: false, error: '保存失败：' + ((err && err.message) || String(err)) }) }
      }, [loadSubs, set])
      const onOpenSub = React.useCallback(async (p) => {
        try { const r = await host.call('submission_read', { path: p }); set({ gradeCurrent: r, gradeResult: '', gradeTrace: null }) }
        catch (err) { set({ error: '读取失败：' + ((err && err.message) || String(err)) }) }
      }, [set])
      const onGrade = React.useCallback(async (p) => {
        const cur = stRef.current
        set({ busy: true, error: '', gradeResult: '', gradeTrace: null })
        try {
          const r = await host.call('submission_grade', { path: p, lesson: cur.gradeLesson ? cur.gradeLesson.no : 0 })
          set({ busy: false, gradeResult: (r && r.feedback) || '（无返回）', gradeTrace: (r && r.trace) || null, notice: r && r.planMissing ? '注意：该课时教案尚未撰写，批改依据不完整' : '批改完成' })
          if (cur.gradeLesson) await loadSubs(cur.gradeLesson.no)
        } catch (err) { set({ busy: false, error: '批改失败：' + ((err && err.message) || String(err)) }) }
      }, [loadSubs, set])
      React.useEffect(() => {
        const onUp = () => {
          if (stRef.current.mode !== 'text') return
          const pop = document.getElementById('cip-pop')
          if (!pop) return
          later(() => {
            const sel = window.getSelection()
            const text = sel ? String(sel).trim() : ''
            if (!text || text.length < 2) { pop.style.display = 'none'; return }
            let r
            try { r = sel.getRangeAt(0).getBoundingClientRect() } catch (e) { return }
            if (!r || (!r.width && !r.height)) return
            pop.style.left = Math.max(8, Math.min(window.innerWidth - 160, r.left + r.width / 2 - 60)) + 'px'
            pop.style.top = Math.max(8, r.top - 38) + 'px'
            pop.style.display = 'block'
            pop.dataset.text = text
          }, 0)
        }
        document.addEventListener('mouseup', onUp)
        return () => document.removeEventListener('mouseup', onUp)
      }, [later])
      const wh = Object.assign({}, st, {
        onRegion: onRegion, onAsk: onAsk, onAdvance: advance, onSave: saveSections,
        onRerunAi: rerunAi, onOpenIssue: openIssue, onFollowUp: onFollowUp,
        onSaveSub: onSaveSub, onOpenSub: onOpenSub, onGrade: onGrade, onAudit: onAudit,
      })
      const canGrade = !st.info || st.info.canGrade !== false
      const canAudit = !st.info || st.info.canAudit !== false
      const views = [
        { id: 'chapter', label: '章节' },
        { id: 'ppt', label: '课件' },
        { id: 'doc', label: '教案' },
      ]
      if (canGrade) views.push({ id: 'grade', label: '作业批改' })
      views.push({ id: 'issue', label: '问题池' })
      return h('div', { className: 'k22' },
        h('div', { className: 'k23' },
          h('div', null,
            h('div', { className: 'k9a' },
              h('div', { className: 'k10' }, '课程问题池'),
              st.info ? h('span', {
                className: 'k9b',
                'data-role': st.info.role || 'student',
                title: (st.info.role === 'teacher')
                  ? '教师端：可以批改作业、审计问题、决定哪些问题共享给全班'
                  : '学生端：提问默认只属于你自己，老师审核后才可能共享给全班。\n教师端请用 课程发布\\teacher.ps1 启动（缺省是学生，这是刻意的）',
              }, st.info.role === 'teacher' ? '教师' : '学生') : null,
              (st.info && st.info.courseCode) ? h('span', { className: 'k9c' }, st.info.courseCode) : null),
            h('div', { className: 'k41' }, st.info
              ? ('问题 ' + (st.items || []).length + ' 条 · 课件 ' + (st.slides ? st.slides.slideCount : 0) + ' 页 · 材料 ' + (st.docs || []).length + ' 份'
                + (st.info.mediaOk ? '' : ' · 无图') + (st.katexReady ? ' · 公式已就绪' : ''))
              : '加载中…')),
          h('div', { className: 'k54' }),
          h('div', { className: 'k24' }, views.map((v) => h('span', {
            key: v.id, className: 'k43', 'data-on': st.view === v.id ? '1' : '0',
            onClick: () => set({ view: v.id, mode: v.id === 'doc' ? 'text' : (v.id === 'ppt' ? 'region' : st.mode), box: null }),
          }, v.label))),
          st.view === 'ppt' ? h('div', { className: 'k24' },
            h('span', { className: 'k43', 'data-on': st.mode === 'region' ? '1' : '0', onClick: () => set({ mode: 'region' }) }, '框选图区'),
            h('span', { className: 'k43', 'data-on': st.mode === 'text' ? '1' : '0', onClick: () => set({ mode: 'text' }) }, '拖选文字')) : null,
          h('button', { className: 'k42', disabled: st.busy, onClick: loadAll }, st.busy ? '处理中…' : '刷新')),
        st.error ? h('div', { className: 'k52 k53', style: { margin: '8px 14px 0' } }, st.error) : null,
        st.notice ? h('div', { className: 'k52 k62', style: { margin: '8px 14px 0' } }, st.notice) : null,
        h('div', { className: 'k25' },
          h('div', { className: 'k44 k26' },
            h('div', { className: 'k64' }, '章节'),
            h('div', { className: 'k70' }, (st.info && st.info.chapters ? st.info.chapters : [st.chapter]).map((ch) => h('span', {
              key: ch, className: 'k71', 'data-on': st.chapter === ch ? '1' : '0', onClick: () => switchChapter(ch),
            }, ch))),
            h('div', { className: 'k64' }, '课时脉络'),
            h('div', { className: 'k1' },
              st.tree ? h(Fishbone, { tree: st.tree, onPick: pickLesson, selected: st.gradeLesson ? st.gradeLesson.no : 0 }) : h('div', { className: 'k21' }, '索引加载中…')),
            h('div', { className: 'k57', style: { marginBottom: '9px' } }, '点课时 → 进入作业批改。黄点 = 教案未撰写。'),
            sideList(st, openDoc, set)),
          h('div', { className: 'k44 k27' },
            st.view === 'chapter' ? h(ChapterView, { st: wh, set: set, onSwitch: switchChapter, onPick: pickLesson })
              : st.view === 'ppt' ? h(SlideView, { st: wh, set: set })
              : st.view === 'doc' ? h(DocView, { st: wh })
                : (st.view === 'grade' && canGrade) ? h(GradeView, { st: wh, set: set })
                  : h(IssueListView, { st: wh, set: set })),
          h('div', { className: 'k44 k12' },
            st.view === 'issue' ? h(Detail, { st: wh, set: set }) : h(AskPanel, { st: wh, set: set }))),
        h('button', {
          id: 'cip-pop', className: 'k49',
          onClick: () => {
            const pop = document.getElementById('cip-pop')
            const text = pop ? (pop.dataset.text || '') : ''
            if (!text) return
            pop.style.display = 'none'
            const cur = stRef.current
            set({ picked: { kind: 'text', text: text, origin: cur.docRef ? cur.docRef.name : '教案', dataUrl: null } })
          },
        }, '就这段提问'))
    }
    
    function sideList(st, openDoc, set) {
      const out = []
      const groups = {}
      for (const d of (st.docs || [])) {
        const k = d.group || '其他'
        groups[k] = groups[k] || []
        groups[k].push(d)
      }
      for (const g of Object.keys(groups)) {
        out.push(h('div', { key: 'g' + g, className: 'k64' }, g))
        for (const d of groups[g]) {
          out.push(h('div', { key: d.path, className: 'k45', 'data-sel': st.selPath === d.path ? '1' : '0', onClick: () => openDoc(d) }, d.name))
        }
      }
      return out
    }
    
    const CIP_MEDIA = '/cip-media'
    const CIP_ACTION = {"pool_info":"info","pool_list":"pool","course_tree":"tree","slides_get":"slides","doc_list":"docs","doc_get":"docs","pool_read":"pool","pool_ask":"ask","pool_followup":"followup","pool_ai_answer":"aianswer","pool_update":"update","submission_list":"submission.list","submission_save":"submission.save","submission_read":"submission.read","submission_grade":"submission.grade","audit_issue":"audit"}
    const host = {
      async call(name, args) {
        const action = CIP_ACTION[name] || name
        const res = await fetch('/cip-api/' + encodeURIComponent(action), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) })
        let data = null
        try { data = await res.json() } catch (e) { data = null }
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
        return data
      },
    }
    const inject = ['slots', 'timer']
    function apply(ctx) {
        const disposers = []
        const timer = ctx.get('timer')
        if (!timer) console.error('[cip] timer 服务不可用')
        ensureCss()
        try {
          disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: '课程问题池',
          }, (props) => h(RailIcon, props))))
        } catch (error) { console.error('[cip] 侧栏注册抛错', error) }
        try {
          disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main', key: PANEL_ID,
          }, () => h(Panel, { timer: timer }))))
        } catch (error) { console.error('[cip] 主面板注册抛错', error) }
        ctx.effect(() => () => {
          for (const d of disposers) { try { d() } catch (error) { console.error('[cip] dispose failed', error) } }
        }, 'course-issue-pool cleanup')
        console.log('[cip] client apply 完毕（v15）')
    }
    exports.name = 'course-panel'
    exports.inject = inject
    exports.apply = apply
    
    return module.exports;
  },
});
