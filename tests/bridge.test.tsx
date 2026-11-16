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
