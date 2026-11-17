import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { fenceCount, mayBeIn, normalize, trKey } from '../hooks/text'

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
  expect((await ui.find({ type: 'Text' }))?.text).toBe('修复登录页的 bug')
  await ui.unmount()
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

test('a failed request sends the prompt as typed', { options: { apiKey: 'sk-test' } }, async ($, on) => {
  on('http.fetch', () => ({ value: { status: 500, ok: false, headers: {}, text: 'boom' } }))
  on('ui.toast', () => ({ value: undefined }))
  let reached = ''
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })

  await $.prompt.submit({ text: '修复 bug', origin: { kind: 'composer' }, wait: false })
  expect(reached).toBe('修复 bug')
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

  expect((await ui.find({ type: 'Text' }))?.text).toBe('【zh-CN】Fixed the bug.')
  await ui.unmount()
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
  { options: { provider: 'api', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', extraBody: '{"top_p": 0.5}' } },
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

// --- 0.3.0: language of new files --------------------------------------------

import { FILES_SECTION_ID, filesSection } from '../hooks/files'

// A test passes the whole input; the engine's own composition stands in as one section.
const composeInput = { model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] }
const engineSection = (on: any) => on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }))
const compose = async ($: any) => (await $.prompt.compose(composeInput)).sections as { id: string; text: string; scope: string }[]
const filesText = async ($: any) =>
  (await compose($)).find(sec => sec.id === FILES_SECTION_ID)

test('the files section names the language by its code, leaves replies alone and never mentions translation', async () => {
  const text = filesSection('ja')
  expect(text).toContain('in ja unless')
  expect(text).not.toContain('Japanese')
  expect(text).not.toContain('read by')
  expect(text).toContain('only to files you create')
  expect(text).toContain('does not change the language you reply in')
  expect(text).not.toContain('translat')
  expect(text).toContain('bilingual')
})

test('the system prompt carries the files section once, after the cache boundary', async ($, on) => {
  engineSection(on)
  const first = await filesText($)
  expect(first?.scope).toBe('session')
  expect(first?.text).toContain('in zh-CN unless')
  const sections = await compose($)
  expect(sections[0]?.id).toBe('intro')
  expect(sections.filter(sec => sec.id === FILES_SECTION_ID).length).toBe(1)
})

test('/lang switches the files section; en drops it', async ($, on) => {
  engineSection(on)
  on('command.register', () => ({ value: { command: 'lang' } }))
  await $.command.run(lang('ko'))
  expect((await filesText($))?.text).toContain('in ko unless')
  await $.command.run(lang('en'))
  expect(await filesText($)).toBeUndefined()
})

test('fileLanguage en leaves the system prompt alone', { options: { fileLanguage: 'en' } }, async ($, on) => {
  engineSection(on)
  expect(await filesText($)).toBeUndefined()
})
