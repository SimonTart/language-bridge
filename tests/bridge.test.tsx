import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { fenceCount, mayBeIn, normalize, preview, trKey } from '../hooks/text'

// The engine's own drawing of a row: its text, so a test can read it back.
function drawText(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
}

// The engine stamps origin and presentation on a typed command; a test fills them in.
const lang = (args: string) =>
  ({ command: 'lang', args, origin: { kind: 'composer' } }) as unknown as CommandRunInput

test('helpers: script check, fences, keys', async () => {
  expect(mayBeIn('zh-CN', 'fix the bug')).toBe(false)
  expect(mayBeIn('zh-CN', '修复这个 bug')).toBe(true)
  expect(mayBeIn('fr', 'fix the bug')).toBe(true) // Latin script: the translator decides
  expect(fenceCount('a\n```ts\nx\n```\n')).toBe(2)
  expect(normalize('  hi <context>secret</context> ')).toBe('hi')
  expect(trKey('ja', 'Hello')).toBe(trKey('ja', '  Hello\n'))
  expect(trKey('ja', 'Hello')).not.toBe(trKey('ko', 'Hello'))
})

test('a Chinese prompt reaches the model in English and is drawn as typed', async ($, on) => {
  let reached = ''
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })
  drawText(on)

  await $.prompt.submit({ text: '修复登录页的 bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBe('[en] 修复登录页的 bug') // the fake translator, no key set

  const ui = await $.ui.mount({
    plugin: 'language-bridge',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: reached, origin: { kind: 'composer' }, isExpanded: false },
  })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts[0]?.text).toBe('修复登录页的 bug')
  // The English the model read, dim beneath it.
  expect(texts[1]?.text).toBe('→ [en] 修复登录页的 bug')
  expect(texts[1]?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('a long prompt shows a preview of its English; the expanded view shows it whole', async ($, on) => {
  let reached = ''
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })
  drawText(on)

  await $.prompt.submit({ text: '第一行\n第二行\n第三行', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBe('[en] 第一行\n第二行\n第三行')

  for (const isExpanded of [false, true]) {
    const ui = await $.ui.mount({
      plugin: 'language-bridge',
      surface: 'terminal',
      component: 'UserMessage',
      props: { text: reached, origin: { kind: 'composer' }, isExpanded },
    })
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts[0]?.text).toBe('第一行\n第二行\n第三行')
    expect(texts[1]?.text).toBe(isExpanded ? '→ [en] 第一行\n第二行\n第三行' : '→ [en] 第一行\n第二行…')
    await ui.unmount()
  }
})

test('preview: lines and characters', async () => {
  expect(preview('one')).toBe('one')
  expect(preview('one\n\ntwo\nthree')).toBe('one\ntwo…')
  expect(preview('x'.repeat(200))).toBe(`${'x'.repeat(159)}…`)
})

test('an English prompt passes untouched, with no request', async ($, on) => {
  let reached = ''
  let requests = 0
  on('http.fetch', () => {
    requests++
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })

  await $.prompt.submit({ text: 'fix the login bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBe('fix the login bug')
  expect(requests).toBe(0)
})

test(
  'the API is asked with the key, model and target language, thinking off',
  { options: { apiKey: 'sk-test', language: 'ja' } },
  async ($, on) => {
    let sent: { url: string; auth: string; body: any } | undefined
    on('http.fetch', (_, e) => {
      const init = e.init ?? {}
      sent = {
        url: e.url,
        auth: (init.headers as Record<string, string>).Authorization!,
        body: JSON.parse(init.body as string),
      }
      const reply = { choices: [{ message: { content: 'Fix the login bug' } }] }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
    })
    let reached = ''
    on('prompt.submit', (_, e) => {
      reached = e.text
      return { text: e.text }
    })

    await $.prompt.submit({ text: 'ログインのバグを直して', origin: { kind: 'composer' }, wait: false })
    expect(reached).toBe('Fix the login bug')
    expect(sent?.url).toBe('https://api.siliconflow.cn/v1/chat/completions')
    expect(sent?.auth).toBe('Bearer sk-test')
    expect(sent?.body.model).toBe('deepseek-ai/DeepSeek-V4.1-Flash')
    expect(sent?.body.enable_thinking).toBe(false)
    expect(sent?.body.messages[0].content).toContain('English')
  },
)

test('a failed request sends nothing and puts the prompt back in the box', { options: { apiKey: 'sk-test' } }, async ($, on) => {
  on('http.fetch', () => ({ value: { status: 500, ok: false, headers: {}, text: 'boom' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  let filled = ''
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  let reached: string | undefined
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })

  const result = await $.prompt.submit({ text: '修复 bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBeUndefined()
  expect(result.drop).toContain('translation failed')
  expect(filled).toBe('修复 bug')
})

test('a reply is drawn in translation once its step ends', async ($, on) => {
  const clock = mock.clock(on)
  drawText(on)
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'Fixed the ' } as any
    yield { kind: 'text', index: 0, text: 'bug.' } as any
    return { turnId: e.turnId, index: e.index, answer: 'Fixed the bug.', toolUses: [], stopReason: 'end_turn' } as any
  })

  const props = { text: 'Fixed the bug.', isFirstOfReply: true }
  const ui = await $.ui.mount({ plugin: 'language-bridge', surface: 'terminal', component: 'AssistantMessage', props })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Fixed the bug.')

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
    // drain the stream as the engine would
  }
  await clock.advance(10)

  const texts = await ui.findAll({ type: 'Text' })
  expect(texts[0]?.text).toBe('【zh-CN】Fixed the bug.')
  // The English it came from, dim beneath it.
  expect(texts[1]?.text).toBe('→ Fixed the bug.')
  expect(texts[1]?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('a long reply shows a preview of its English; an untranslated one shows nothing extra', async ($, on) => {
  const clock = mock.clock(on)
  drawText(on)
  const long = 'First line.\nSecond line.\nThird line.'
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: long } as any
    return { turnId: e.turnId, index: e.index, answer: long, toolUses: [], stopReason: 'end_turn' } as any
  })
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'm', messageCount: 1 })) {
    // drain
  }
  await clock.advance(10)

  const ui = await $.ui.mount({
    plugin: 'language-bridge',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: long, isFirstOfReply: true },
  })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts[1]?.text).toBe('→ First line.\nSecond line.…')
  await ui.unmount()

  const plain = await $.ui.mount({
    plugin: 'language-bridge',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Not seen by the translator.', isFirstOfReply: true },
  })
  expect((await plain.findAll({ type: 'Text' })).length).toBe(1)
  await plain.unmount()
})

test('/lang switches the language and en turns translation off', async ($, on) => {
  on('command.register', () => ({ value: { command: 'lang' } }))
  let reached = ''
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })

  const off = await $.command.run(lang('en'))
  expect(off.text).toContain('off')
  await $.prompt.submit({ text: '修复 bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBe('修复 bug')

  const bad = await $.command.run(lang('not a code'))
  expect(bad.text).toContain('not a language code')
})

// --- 0.2.0 -----------------------------------------------------------------

import { endpoint, protect, restore } from '../hooks/translate'

const reply = (content: string) => ({
  value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ message: { content } }] }) },
})

test('code blocks become placeholders and come back byte for byte', async () => {
  const text = 'Run this:\n\n```sh\nnpm test\n```\n\nThen this:\n\n~~~\nls -la\n~~~\n'
  const { masked, blocks } = protect(text)
  expect(blocks.length).toBe(2)
  expect(masked).not.toContain('npm test')
  expect(masked).toContain('⟦CODE_0⟧')
  expect(restore(masked, blocks)).toBe(text)
  expect(() => restore(masked.replace('⟦CODE_1⟧', ''), blocks)).toThrow()
  expect(() => restore(masked + '⟦CODE_0⟧', blocks)).toThrow()
})

test('baseUrl takes the API root or the full chat completions URL', async () => {
  expect(endpoint('https://api.siliconflow.cn/v1')).toBe('https://api.siliconflow.cn/v1/chat/completions')
  expect(endpoint('https://api.siliconflow.cn/v1/')).toBe('https://api.siliconflow.cn/v1/chat/completions')
  expect(endpoint('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions')
})

test('the model never sees the code, and a code-only reply costs no request', { options: { apiKey: 'sk-test' } }, async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('http.fetch', (_, e) => {
    const body = JSON.parse(e.init!.body as string)
    sent.push(body.messages[1].content)
    return reply('<source>\n修好了：\n\n⟦CODE_0⟧\n</source>')
  })
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'Fixed:\n\n```ts\nconst a = 1\n```' } as any
    yield { kind: 'text', index: 1, text: '```ts\nonly code\n```' } as any
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as any
  })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) {
    // drain
  }
  await clock.advance(10)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('<source>')
  expect(sent[0]).not.toContain('const a = 1')
})

test(
  'provider api calls a keyless server, with extraBody as given',
  {
    options: {
      provider: 'api',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
      thinkingFormat: 'none',
      extraBody: '{"top_p": 0.5}',
    },
  },
  async ($, on) => {
    let headers: Record<string, string> = {}
    let body: any
    on('http.fetch', (_, e) => {
      headers = e.init!.headers as Record<string, string>
      body = JSON.parse(e.init!.body as string)
      return reply('fix the bug')
    })
    on('env.get', () => ({ value: undefined }))
    on('command.register', () => ({ value: { command: 'lang' } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('prompt.submit', (_, e) => ({ text: e.text }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    await $.prompt.submit({ text: '修 bug', origin: { kind: 'composer' }, wait: false })
    expect(headers.Authorization).toBeUndefined()
    expect(body.model).toBe('qwen2.5:7b')
    expect(body.top_p).toBe(0.5)
    expect(body.enable_thinking).toBeUndefined()
  },
)

// --- 0.6.0: thinking formats -------------------------------------------------

import { THINKING_FORMATS, stripThinking, thinkingOff } from '../hooks/translate'

// Captures the body of each request the translator sends, answering `content`.
function captureBodies(on: any, content: string): any[] {
  const bodies: any[] = []
  on('http.fetch', (_: unknown, e: any) => {
    bodies.push(JSON.parse(e.init!.body as string))
    return reply(content)
  })
  return bodies
}

test('each thinking format sends its own off field', async () => {
  expect(thinkingOff('qwen')).toEqual({ enable_thinking: false })
  expect(thinkingOff('deepseek')).toEqual({ thinking: { type: 'disabled' } })
  expect(thinkingOff('zai')).toEqual({ thinking: { type: 'disabled' } })
  expect(thinkingOff('openrouter')).toEqual({ reasoning: { effort: 'none' } })
  expect(thinkingOff('together')).toEqual({ reasoning: { enabled: false } })
  expect(thinkingOff('chat-template')).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  expect(thinkingOff('none')).toEqual({})
  expect(THINKING_FORMATS.length).toBe(7)
})

test('a leading thinking block is dropped; one inside the text stays', async () => {
  expect(stripThinking('<think>\nhmm\n</think>\n\n修好了')).toBe('\n\n修好了')
  expect(stripThinking('  <think></think>修好了')).toBe('修好了')
  expect(stripThinking('用 <think> 标签')).toBe('用 <think> 标签')
  expect(stripThinking('修好了')).toBe('修好了')
})

test(
  'thinkingFormat deepseek sends thinking.type, and only that',
  { options: { apiKey: 'sk-test', thinkingFormat: 'deepseek' } },
  async ($, on) => {
    const bodies = captureBodies(on, 'fix the bug')
    on('prompt.submit', (_, e) => ({ text: e.text }))
    await $.prompt.submit({ text: '修 bug', origin: { kind: 'composer' }, wait: false })
    expect(bodies[0].thinking).toEqual({ type: 'disabled' })
    expect(bodies[0].enable_thinking).toBeUndefined()
  },
)

test('an unknown thinkingFormat falls back to qwen', { options: { apiKey: 'sk-test', thinkingFormat: 'nope' } }, async ($, on) => {
  const bodies = captureBodies(on, 'fix the bug')
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.prompt.submit({ text: '修 bug', origin: { kind: 'composer' }, wait: false })
  expect(bodies[0].enable_thinking).toBe(false)
})

test(
  'extraBody may change the thinking field and temperature, never model, stream or messages',
  {
    options: {
      apiKey: 'sk-test',
      extraBody: '{"enable_thinking": true, "temperature": 0.3, "model": "x", "stream": true, "messages": []}',
    },
  },
  async ($, on) => {
    const bodies = captureBodies(on, 'fix the bug')
    on('prompt.submit', (_, e) => ({ text: e.text }))
    await $.prompt.submit({ text: '修 bug', origin: { kind: 'composer' }, wait: false })
    const body = bodies[0]
    expect(body.enable_thinking).toBe(true)
    expect(body.temperature).toBe(0.3)
    expect(body.model).toBe('deepseek-ai/DeepSeek-V4.1-Flash')
    expect(body.stream).toBe(false)
    expect(body.messages.length).toBe(2)
  },
)

test('a thinking block in the answer never reaches the model', { options: { apiKey: 'sk-test' } }, async ($, on) => {
  captureBodies(on, '<think>The user wants a bug fixed.</think>\nFix the bug')
  let reached = ''
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })
  await $.prompt.submit({ text: '修 bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBe('Fix the bug')
})

test('an answer that is only a thinking block counts as a failed translation', { options: { apiKey: 'sk-test' } }, async ($, on) => {
  captureBodies(on, '<think>Hmm.</think>')
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  let reached: string | undefined
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })
  const result = await $.prompt.submit({ text: '修 bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBeUndefined()
  expect(result.drop).toContain('translation failed')
})

const QUESTIONS = [
  {
    question: 'Which email should the commit use?',
    header: 'Commit email',
    multiSelect: false,
    options: [
      { label: 'Noreply', description: 'Keeps your address private' },
      { label: 'Current', description: 'Uses your git config' },
    ],
  },
]

test('the question dialog is drawn in translation once it is ready', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => ({ result: {} }) as any)
  // The dialog must keep the engine's own node: record what reaches it.
  let drawn: any[] = []
  on('ui.render', { component: 'AskUserQuestion' }, (_, e, next) => {
    drawn = (e.props as any).questions
    return next(e)
  })

  await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  await clock.advance(10)

  const ui = await $.ui.mount({
    plugin: 'language-bridge',
    surface: 'terminal',
    component: 'AskUserQuestion',
    props: { tool: 'AskUserQuestion', questions: QUESTIONS },
  } as any)
  const q = drawn[0]
  expect(q.question).toBe('【zh-CN】Which email should the commit use?')
  // The fake tag makes the header longer than 12 characters, so it stays.
  expect(q.header).toBe('Commit email')
  expect(q.options[0].label).toBe('【zh-CN】Noreply')
  expect(q.options[1].description).toBe('【zh-CN】Uses your git config')
  expect(q.multiSelect).toBe(false)
  await ui.unmount()
})

test('the wrap-up box shows its recap, question and buttons translated', async ($, on) => {
  const clock = mock.clock(on)
  const nextStep = { recap: 'Released v0.1.0.', ask: 'Install it now?', blocked: true, actions: [{ label: 'Yes' }, { action: 'verify' }] }
  on('tool.call', () => ({ result: { asks: true, nextStep } }) as any)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const step = (e.props as any).output.nextStep
    return <Text>{[step.recap, step.ask, step.actions[0].label, step.actions[1].action].join(' | ')}</Text>
  })

  await $.tool.call({ tool: 'WrapUp', recap: nextStep.recap, ask: nextStep.ask } as any)
  await clock.advance(10)

  const ui = await $.ui.mount({
    plugin: 'language-bridge',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'w1', tool: 'WrapUp', output: { asks: true, nextStep }, isErrored: false },
  } as any)
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    '【zh-CN】Released v0.1.0. | 【zh-CN】Install it now? | 【zh-CN】Yes | verify',
  )
  await ui.unmount()
})

test('the session is titled once, from the first prompt as typed', async ($, on) => {
  on('classic.UserPromptSubmit', () => ({}))
  const long = '帮我把这个插件发布到 GitHub 上，写好 README 和配置说明，说明安装方法和每个配置项的含义，再打一个 release'
  const first = await $.classic.UserPromptSubmit({ prompt: long } as any)
  expect((first as any).sessionTitle).toBe(long.slice(0, 49) + '…')
  const second = await $.classic.UserPromptSubmit({ prompt: '再改一下' } as any)
  expect((second as any).sessionTitle).toBeUndefined()
})

// --- 0.8.0: the system prompt is the engine's --------------------------------

test('the system prompt is left as the engine composed it', async ($, on) => {
  const composeInput = { model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] }
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }))
  const { sections } = await $.prompt.compose(composeInput as any)
  expect(sections.map((sec: { id: string }) => sec.id)).toEqual(['intro'])
})

// --- 0.9.0 -----------------------------------------------------------------

import { pieces } from '../hooks/text'

const para = (n: number) => `Paragraph ${n}. ${'word '.repeat(40).trim()}`

test('pieces: cut at blank lines once big enough, the same while streaming and whole', async () => {
  expect(pieces('Short reply.')).toEqual(['Short reply.'])
  const text = [1, 2, 3, 4, 5, 6, 7, 8].map(para).join('\n\n')
  const whole = pieces(text, true, 400)
  expect(whole.length).toBeGreaterThan(1)
  expect(whole.join('\n\n')).toBe(text)
  // Every prefix closes only pieces the whole text also has, in order.
  for (let end = 1; end <= text.length; end += 7) {
    const closed = pieces(text.slice(0, end), false, 400)
    expect(closed).toEqual(whole.slice(0, closed.length))
    expect(closed.length).toBeLessThan(whole.length)
  }
})

test('pieces: never inside a code fence or before an indented line', async () => {
  const code = '```\n' + 'line\n\n'.repeat(200) + '```'
  expect(pieces(`${para(1)}\n\n${code}\n\nAfter.`, true, 100)).toEqual([para(1), code, 'After.'])
  const list = `1. ${para(1)}\n\n   ${para(2)}\n\n2. ${para(3)}`
  expect(pieces(list, true, 100)).toEqual([`1. ${para(1)}\n\n   ${para(2)}`, `2. ${para(3)}`])
})

test('pieces: whole paragraphs, closed past 500 characters', async () => {
  const text = [1, 2, 3, 4, 5, 6, 7, 8].map(para).join('\n\n')
  const out = pieces(text)
  expect(out[0]).toBe([1, 2, 3].map(para).join('\n\n')) // 216 characters each
  expect(out.length).toBe(3)
})

test('a long reply is translated piece by piece while it streams', async ($, on) => {
  const clock = mock.clock(on)
  drawText(on)
  const parts = [1, 2, 3, 4, 5, 6].map(para)
  const text = parts.join('\n\n')
  const expected = pieces(text)
  expect(expected.length).toBeGreaterThan(1)

  on('turn.step', async function* (_, e) {
    for (const p of parts) yield { kind: 'text', index: 0, text: `${p}\n\n` } as any
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn' } as any
  })
  const ui = await $.ui.mount({
    plugin: 'language-bridge',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  })

  let midStream = ''
  let seen = 0
  for await (const _ of $.turn.step({ turnId: 't9', index: 0, model: 'm', messageCount: 1 })) {
    if (++seen === parts.length - 1) {
      await clock.advance(10)
      midStream = (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''
    }
  }
  // Before the step ended, the first piece was shown translated, the rest in English.
  expect(midStream.startsWith(`【zh-CN】${expected[0]}`)).toBe(true)
  expect(midStream.endsWith(expected[expected.length - 1]!)).toBe(true)

  await clock.advance(10)
  const done = (await ui.findAll({ type: 'Text' }))[0]?.text
  expect(done).toBe(expected.map(p => `【zh-CN】${p}`).join('\n\n'))
  await ui.unmount()
})
