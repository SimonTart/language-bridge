import type { EngineInterface, Register } from 'claude-code'

import { hash, isEnglish, isValidLang, mayBeIn, normalize, trKey } from './text'
import { translate, type TranslatorConfig } from './translate'

const tr = { plugin: 'language-bridge', key: 'tr' } as const
const orig = { plugin: 'language-bridge', key: 'orig' } as const
const langRef = { plugin: 'language-bridge', key: 'lang' } as const

/** Prompts longer than this (a pasted log, a file) go to the model as typed. */
const MAX_INPUT_CHARS = 8000

const TYPED_ORIGINS = new Set<string>(['composer', 'bridge', 'sdk'])

type Settings = { config: TranslatorConfig; configured: string }

// Reply blocks being translated now, so a block is sent once. A reload
// forgets it, at worst translating a block twice.
const inFlight = new Set<string>()
// One error toast per kind of failure, not one per block.
let lastError = ''

async function currentLang($: EngineInterface, s: Settings): Promise<string> {
  const { value } = await $.state.get(langRef)
  return value ?? s.configured
}

function report($: EngineInterface, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === lastError) return
  lastError = msg
  $.ui.toast(`language-bridge: ${msg}`)
}

async function translateReply($: EngineInterface, s: Settings, lang: string, text: string) {
  if (!normalize(text)) return
  const id = trKey(lang, text)
  if (inFlight.has(id)) return
  const { value } = await $.state.get({ ...tr, id })
  if (value !== undefined) return
  inFlight.add(id)
  try {
    const out = await translate($, s.config, text, lang)
    // Unchanged: the reply was already in the person's language.
    if (normalize(out) !== normalize(text)) {
      await $.state.set({ ...tr, id }, out)
    }
    lastError = ''
  } catch (err) {
    report($, err)
  } finally {
    inFlight.delete(id)
  }
}

async function translateReplies($: EngineInterface, s: Settings, texts: string[]) {
  const lang = await currentLang($, s)
  if (isEnglish(lang)) return
  await Promise.all(texts.map(text => translateReply($, s, lang, text)))
}

export const register: Register = (on, options) => {
  const s: Settings = {
    config: {
      apiKey: String(options.apiKey ?? '').trim(),
      model: String(options.model ?? 'deepseek-ai/DeepSeek-V4.1-Flash').trim(),
      baseUrl: String(options.baseUrl ?? 'https://api.siliconflow.cn/v1').trim(),
    },
    configured: String(options.language ?? 'zh-CN').trim() || 'en',
  }

  on('session.start', async ($, e, next) => {
    // A secret userConfig field has no row in /config; the environment is the
    // other way to give the key, and the field wins when both are set.
    if (!s.config.apiKey) s.config.apiKey = ((await $.env.get('SILICONFLOW_API_KEY')) ?? '').trim()
    await $.command.register({
      name: 'lang',
      description: 'Show or switch the language replies are translated into (this session)',
      argumentHint: '[code | en | reset]',
    })
    return next(e)
  })

  on('command.run', { command: 'lang' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) {
      const lang = await currentLang($, s)
      const provider = s.config.apiKey ? `${s.config.model} via ${s.config.baseUrl}` : 'fake (no API key set)'
      return {
        text: `Language: ${lang}${isEnglish(lang) ? ' (translation off)' : ''}\nTranslator: ${provider}`,
      }
    }
    if (arg === 'reset') {
      await $.state.set(langRef, s.configured)
      return { text: `Language reset to ${s.configured}.` }
    }
    if (!isValidLang(arg)) {
      return {
        text: `"${arg}" is not a language code. Use a BCP-47 code such as zh-CN, ja, ko, fr, or en to turn translation off.`,
      }
    }
    await $.state.set(langRef, arg)
    return {
      text: isEnglish(arg)
        ? 'Translation off for this session.'
        : `Replies from now on are shown in ${arg}; earlier ones stay as they were.`,
    }
  })

  // Input: the person's language → English, before the model reads it.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    // Only what a person typed: at the terminal, through remote control, or
    // in an SDK host such as the desktop app or `claude -p`.
    if (!TYPED_ORIGINS.has(e.origin.kind)) return next(e)
    const lang = await currentLang($, s)
    if (isEnglish(lang) || !mayBeIn(lang, e.text)) return next(e)
    if (e.text.length > MAX_INPUT_CHARS) {
      $.ui.toast(`language-bridge: prompt over ${MAX_INPUT_CHARS} characters, sent untranslated`)
      return next(e)
    }
    let english: string
    try {
      english = await translate($, s.config, e.text, 'en')
    } catch (err) {
      report($, err)
      return next(e)
    }
    if (normalize(english) === normalize(e.text)) return next(e)
    await $.state.set({ ...orig, id: hash(normalize(english)) }, e.text)
    return next({ ...e, text: english })
  }).catch(($, e, next) => next(e)) // a failed hook sends the prompt as typed

  // Show the prompt as typed, though the transcript stores its English.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { value } = await $.state.get({ ...orig, id: hash(normalize(e.props.text)) })
    return value ? next({ ...e, props: { ...e.props, text: value } }) : next(e)
  })

  // Output: collect each text block of a main-loop response as it streams by,
  // then translate after the step, off the turn's path.
  on('turn.step', async function* ($, e, next) {
    const blocks = new Map<number, string>()
    for await (const chunk of next(e)) {
      if (chunk.kind === 'text') {
        blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
      }
      yield chunk
    }
    if (e.agentId || blocks.size === 0) return
    const texts = [...blocks.values()]
    $.clock.after(1, () => {
      void translateReplies($, s, texts)
    })
  })

  // Draw a reply block in translation once one is stored. Reading the state
  // subscribes this row, so the write above redraws it in place.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const lang = await currentLang($, s)
    if (isEnglish(lang)) return next(e)
    const { value } = await $.state.get({ ...tr, id: trKey(lang, e.props.text) })
    return value ? next({ ...e, props: { ...e.props, text: value } }) : next(e)
  })
}
