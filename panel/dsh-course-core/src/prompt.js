/**
 * 提示词与模型往返 —— 学生端与教师端共用
 *
 * 这里承载三件必须两边一致的事：
 *   1. 每一轮追问都要**完整作答**（不是「同上」）—— 代价是每轮都真的花一次 token，
 *      这正是老师说的「隐性提问」，费用归发起方。
 *   2. 标题凝练必须用**同一套风格**，否则问题池看起来像好几个人写的。
 *   3. 问题总结与标题出自同一套口径，方便老师扫读与归档。
 */
import { oneLine, callModel, msg, STUDENT_SYSTEM, TITLE_SYSTEM, SUMMARY_SYSTEM, GRADER_SYSTEM } from './host.js'

function base64ToBytes(dataUrl) {
  const s = String(dataUrl || '')
  const i = s.indexOf(',')
  return Buffer.from(i >= 0 ? s.slice(i + 1) : s, 'base64')
}

function buildPrompt(question, anchorText) {
  const q = oneLine(question) || '这块内容是什么意思？请解释其中的关键推导。'
  const parts = ['【学生提问】', q]
  if (anchorText) parts.push('', '【学生指着的内容】', String(anchorText).slice(0, 1500))
  parts.push('', '（如果本次消息带图片，那是学生从课件里框选的一块，请先读懂它再回答。）')
  return parts.join('\n')
}

/**
 * 跑一轮问答。history 是之前的轮次（按时间正序），每轮 {q, a}。
 * 图片只挂在**本轮**消息上 —— 历史轮次的图不重放，否则 token 会随轮数线性膨胀。
 */
export async function runTurn(ctx, { question, anchorText, dataUrl, history, trace }) {
  const log = trace || []
  const messages = []
  for (const turn of history || []) {
    messages.push(msg('user', String(turn.q || '')))
    messages.push(msg('assistant', String(turn.a || '')))
  }
  const text = buildPrompt(question, anchorText)
  const content = [{ type: 'text', text }]
  let imageAttached = false
  if (dataUrl) {
    const attachments = ctx.get('attachments')
    if (attachments !== undefined) {
      try {
        const bytes = base64ToBytes(dataUrl)
        log.push('截图字节: ' + bytes.length)
        const ref = await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'region.png' })
        log.push('附件已保存: ' + ref.width + 'x' + ref.height)
        content.push({ type: 'image', attachment: ref })
        imageAttached = true
      } catch (error) { log.push('附件保存失败: ' + oneLine(error && error.message)) }
    } else { log.push('附件服务不可用') }
  }
  const last = msg('user', text)
  last.content = content
  messages.push(last)
  log.push('消息块: ' + content.map((c) => c.type).join(' + ') + ' / 共 ' + messages.length + ' 条')
  const r = await callModel(ctx, { system: STUDENT_SYSTEM, messages, trace: log })
  return { answer: r.text, usage: r.usage, imageAttached }
}

/** 凝练标题。失败时回落到「取提问前若干字」，绝不让标题生成失败挡住提问本身。 */
export async function makeTitle(ctx, { question, anchorText, trace }) {
  const log = trace || []
  try {
    const r = await callModel(ctx, {
      system: TITLE_SYSTEM,
      messages: [msg('user', '学生提问：' + oneLine(question) + (anchorText ? '\n他指着的内容：' + String(anchorText).slice(0, 600) : ''))],
      trace: log,
    })
    // 模型偶尔会带引号、句号或换行，统一清掉，保证风格一致
    const t = oneLine(r.text).replace(/^["'「『]+|["'」』]+$/g, '').replace(/[。．.]+$/, '')
    if (t) return { title: t.slice(0, 60), usage: r.usage }
  } catch (e) { log.push('标题凝练失败（改用提问原文）: ' + oneLine(e && e.message)) }
  return { title: (oneLine(question) || '未命名提问').slice(0, 60), usage: { inputTokens: 0, outputTokens: 0 } }
}

/** 问题总结（两到三句）。同样失败不阻断主流程。 */
export async function makeSummary(ctx, { question, answer, thread, trace }) {
  const log = trace || []
  const parts = ['【学生最初的提问】', oneLine(question)]
  if (answer) parts.push('', '【第一次回答】', String(answer).slice(0, 2000))
  const turns = (thread || []).slice(-3)
  if (turns.length) {
    parts.push('', '【后续追问】')
    turns.forEach((t, i) => parts.push('第 ' + (i + 1) + ' 轮问：' + oneLine(t.q), '第 ' + (i + 1) + ' 轮答：' + String(t.a || '').slice(0, 800)))
  }
  try {
    const r = await callModel(ctx, { system: SUMMARY_SYSTEM, messages: [msg('user', parts.join('\n'))], trace: log })
    return { summary: oneLine(r.text).slice(0, 300), usage: r.usage }
  } catch (e) { log.push('问题总结失败: ' + oneLine(e && e.message)) }
  return { summary: '', usage: { inputTokens: 0, outputTokens: 0 } }
}

/**
 * 批改一次提交。
 * 教案是**对齐基准** —— 老师特别强调过，避免训练侧重点偏移：
 * 教案要求学生手写实现，学生调库绕过，就必须指出来，不能因为「结果对」就算过。
 */
export async function runGrade(ctx, { plan, code, dimensions, lesson, trace }) {
  const log = trace || []
  const parts = []
  parts.push('【本课时教案】', String(plan || '（未找到教案，只能按通用工程规范初筛，请以教案为准自行核对）').slice(0, 24000))
  parts.push('', '【批改维度】')
  const dims = Array.isArray(dimensions) && dimensions.length ? dimensions : ['正确性', '与教案方法的一致性', '可复现性', '代码规范']
  for (const d of dims) parts.push('- ' + (typeof d === 'string' ? d : (d.name || JSON.stringify(d))))
  parts.push('', '【课时】' + oneLine(lesson))
  parts.push('', '【学生提交的代码】', '```', String(code || '').slice(0, 40000), '```')
  parts.push('', '请按批改原则逐条对照教案的验收标准，逐条给出结论与证据，最后按要求的格式输出《问题清单》。')
  const r = await callModel(ctx, { system: GRADER_SYSTEM, messages: [msg('user', parts.join('\n'))], trace: log })
  return { text: r.text, usage: r.usage }
}
