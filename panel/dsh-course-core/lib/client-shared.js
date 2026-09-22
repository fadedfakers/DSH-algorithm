/**
 * dsh-course-client-core —— 学生端与教师端客户端共享的渲染核心
 *
 * 这个文件是**构建产物**，由 课程发布/tools/extract-client-core.cjs 从已经
 * 验证过的客户端代码里抽段生成。请改源文件后重新构建，不要直接手改这里 ——
 * 手改会在下次构建时被覆盖，而且两边的公式/markdown 渲染会开始漂移。
 *
 * 含：样式与 KaTeX 加载、markdown→HTML（带 $公式$）、徽标与下拉、课程脉络树、图片组件。
 * 不含：任何视图、任何 API 调用 —— 那些按角色在各自的 client.js 里。
 *
 * 用法（各自的 client.js 里）：
 *     globalThis.__CIP_UI_CFG__ = { katex: '/cip-stu-katex', css: '/cip-stu.css', cssId: 'cip-stu-css' }
 *     const ui = require('dsh-course-client-core')   // 直接拿到 ui 对象
 *
 * 全部实现包在一个 IIFE 里，工厂**直接返回 ui 对象**。
 * 曾经的写法是返回一个 makeUI 函数 —— 那样调用方拿到的是一个函数而不是对象，
 * 第一个 ui.xxx 就抛 TypeError（物化测试抓到的就是这个）。ModuleLoader 的约定
 * 是 factory(require) → exports，别在这上面加一层。
 */
window.__ModuleLoader__.load({
  id: 'dsh-course-client-core',
  factory: (require) => {
    const React = require('react')
    return (function makeUI() {
    // ── 路由前缀：由各自的 client.js 在 require 本模块**之前**写进约定位置 ──
    // 学生端与教师端是两个独立插件、两套路由（/cip-stu /cip-tea），所以不能写死。
    // 读不到就回落到旧插件的前缀，便于单独调试。
    const _cfg = (typeof globalThis !== 'undefined' && globalThis.__CIP_UI_CFG__) || {}
    const KATEX_BASE = _cfg.katex || '/cip-katex'
    const CSS_URL = _cfg.css || '/cip-panel.css'
    const CSS_ID = _cfg.cssId || 'cip-panel-css'
    const MEDIA_BASE = _cfg.media || '/cip-media'
    // 三个标签常量在源文件里位于抽取范围之外，但下面的 SECTIONS 引用了 AI_LABEL，
    // 所以必须一并重建 —— 漏了就会在浏览器里抛 ReferenceError（这里加注释是因为
    // 这正是物化测试抓到的问题，别再删）。
    const AI_LABEL = 'AI 答复'
    const THREAD_LABEL = '追问记录'
    const GRADE_LABEL = '作业批改'
/* ── 常量与配色 / 路径前缀 ── */

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
    const FISH_COLORS = ['#4c8dff', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6']

/* ── 样式表注入 ── */

function ensureCss() {
      if (document.getElementById(CSS_ID)) return
      const l = document.createElement('link')
      l.id = CSS_ID
      l.rel = 'stylesheet'
      l.href = CSS_URL
      document.head.appendChild(l)
    }

/* ── 内联样式解析 ── */

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

/* ── React.createElement 快捷方式 ── */

function h(type, props) {
      const children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [type, props].concat(children))
    }

/* ── 徽标 ── */

function bdg(t, c, g) { return h('span', g ? { className: 'k50 k19' } : { className: 'k50', style: { background: c } }, t) }

/* ── 下拉选择 ── */

function pick(options, value, onChange) {
      return h('select', { className: 'k61', value: value, onChange: (e) => onChange(e.target.value) },
        options.map((o) => h('option', { key: o, value: o }, o)))
    }

/* ── 侧栏图标 ── */

function RailIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v9A1.5 1.5 0 0 1 19.5 16h-6.2l-4.3 4v-4H4.5A1.5 1.5 0 0 1 3 14.5v-9Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('circle', { cx: 8.6, cy: 10, r: 1.05, fill: 'currentColor' }),
        h('circle', { cx: 12.2, cy: 10, r: 1.05, fill: 'currentColor' }),
        h('circle', { cx: 15.8, cy: 10, r: 1.05, fill: 'currentColor' }),
        h('path', { d: 'M15.4 3.2h5.4v5.1', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

/* ── KaTeX 状态 ── */

const katexState = { ready: false, error: '', loading: false, queued: [] }

/* ── KaTeX 加载 ── */

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

/* ── HTML 转义 ── */

function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

/* ── 公式占位 ── */

function maskMath(text, store) {
      let out = String(text == null ? '' : text)
      const put = (tex, display) => { const key = '\u0000M' + store.length + '\u0000'; store.push({ tex: tex, display: display }); return key }
      out = out.replace(/\$\$([\s\S]+?)\$\$/g, (m, g) => put(g, true))
      out = out.replace(/\\\[([\s\S]+?)\\\]/g, (m, g) => put(g, true))
      out = out.replace(/\\\(([\s\S]+?)\\\)/g, (m, g) => put(g, false))
      out = out.replace(/\$([^$\n]+?)\$/g, (m, g) => put(g, false))
      return out
    }

/* ── 转义并保留占位 ── */

function escapeExceptPlaceholders(masked) {
      return String(masked).split(/(\u0000M\d+\u0000)/)
        .map((p) => (/^\u0000M\d+\u0000$/.test(p) ? p : esc(p))).join('')
    }

/* ── 公式渲染 ── */

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

/* ── markdown → HTML ── */

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

/* ── Markdown 组件 ── */

function Markdown({ text }) {
      return h('div', { className: 'k63', dangerouslySetInnerHTML: { __html: markdownToHtml(text || '') } })
    }

/* ── 课程脉络树 ── */

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

/* ── 图片组件 ── */

function MediaImage({ src, name, boxStyle, st, set }) {
      const failed = st.brokenMedia && st.brokenMedia[name]
      if (failed) return h('div', { className: 'k55', style: boxStyle, title: failed }, h('b', null, '加载失败'), h('span', null, name))
      return h('img', { src: src, alt: name, style: boxStyle, onError: () => {
        const next = Object.assign({}, st.brokenMedia || {}); next[name] = '加载失败'; set({ brokenMedia: next })
      } })
    }

      return { ensureCss, css, h, bdg, pick, RailIcon, Markdown, markdownToHtml, loadKatex, Fishbone, MediaImage, esc, KATEX_BASE, CSS_URL, CSS_ID, MEDIA_BASE, MODULES, AI_LABEL, THREAD_LABEL, GRADE_LABEL, FLOW, SECTIONS, STATUS_COLOR, SEVERITY_COLOR, TYPES, SEVERITIES, FISH_COLORS, ZOOM_MIN, ZOOM_MAX, NL }
    })()
  },
});
