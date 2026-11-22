import type { EngineInterface, Register } from 'claude-code'

import { FILES_SECTION_ID, filesSection } from './files'
import { hash, isEnglish, isValidLang, mayBeIn, normalize, preview, trKey } from './text'
import {
  THINKING_FORMATS,
  translate,
  translateList,
  usesApi,
  type Provider,
  type ThinkingFormat,
  type TranslatorConfig,
} from './translate'

const tr = { plugin: 'language-bridge', key: 'tr' } as const
const orig = { plugin: 'language-bridge', key: 'orig' } as const
const langRef = { plugin: 'language-bridge', key: 'lang' } as const
const titled = { plugin: 'language-bridge', key: 'titled' } as const

/** Prompts longer than this (a pasted log, a file) go to the model as typed. */
const MAX_INPUT_CHARS = 8000
/** The AskUserQuestion schema caps a header at 12 characters. */
const MAX_HEADER_CHARS = 12
const TITLE_CHARS = 50

// Only what a person typed: at the terminal, through remote control, or in
// an SDK host such as the desktop app or `claude -p`.
const TYPED_ORIGINS = new Set<string>(['composer', 'bridge', 'sdk'])

type Settings = { config: TranslatorConfig; configured: string; files: FileLanguage }

/** auto: tell the model which language to write files in. en: say nothing; files stay English. */
type FileLanguage = 'auto' | 'en'

type Question = {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}
type NextStep = {
  recap: string
  ask?: string
  blocked: boolean
  actions: ({ label: string } | { action: string })[]
}

// Texts being translated now, so each is sent once. A reload forgets it, at
// worst translating a text twice.
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

/**
 * A prompt whose translation failed: send nothing, say why, and put the text
 * back in the prompt box to retry or edit (unless the person typed a new draft).
 */
async function refuse($: EngineInterface, text: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  try {
    const box = await $.prompt.read()
    if (!box.text) await $.prompt.fill({ text })
  } catch {
    // no box to fill (a -p run, an SDK host): the reason still shows
  }
  return { drop: `language-bridge: translation failed, prompt not sent (${msg})` }
}

/** Translates one reply block (markdown) and stores it. */
async function translateBlock($: EngineInterface, s: Settings, lang: string, text: string) {
  if (!normalize(text)) return
  const id = trKey(lang, text)
  if (inFlight.has(id)) return
  const { value } = await $.state.get({ ...tr, id })
  if (value !== undefined) return
  inFlight.add(id)
  try {
    const out = await translate($, s.config, text, lang)
    // Unchanged: the reply was already in the person's language.
    if (normalize(out) !== normalize(text)) await $.state.set({ ...tr, id }, out)
    lastError = ''
  } catch (err) {
    report($, err)
  } finally {
    inFlight.delete(id)
  }
}

async function translateBlocks($: EngineInterface, s: Settings, texts: string[]) {
  const lang = await currentLang($, s)
  if (isEnglish(lang)) return
  await Promise.all(texts.map(text => translateBlock($, s, lang, text)))
}

/** Translates short strings in one request, each stored under its own key. */
async function translateStrings($: EngineInterface, s: Settings, texts: string[]) {
  const lang = await currentLang($, s)
  if (isEnglish(lang)) return
  const todo: string[] = []
  for (const text of new Set(texts)) {
    const id = trKey(lang, text)
    if (!normalize(text) || inFlight.has(id)) continue
    const { value } = await $.state.get({ ...tr, id })
    if (value === undefined) todo.push(text)
  }
  if (todo.length === 0) return
  const ids = todo.map(text => trKey(lang, text))
  ids.forEach(id => inFlight.add(id))
  try {
    const out = await translateList($, s.config, todo, lang)
    for (let i = 0; i < todo.length; i++) {
      if (normalize(out[i]!) !== normalize(todo[i]!)) await $.state.set({ ...tr, id: ids[i]! }, out[i]!)
    }
    lastError = ''
  } catch (err) {
    report($, err)
  } finally {
    ids.forEach(id => inFlight.delete(id))
  }
}

/** The stored translation of each text that has one. Subscribes the drawing. */
async function lookup($: EngineInterface, s: Settings, texts: string[]): Promise<Map<string, string>> {
  const lang = await currentLang($, s)
  const found = new Map<string, string>()
  if (isEnglish(lang)) return found
  for (const text of texts) {
    if (!text || found.has(text)) continue
    const { value } = await $.state.get({ ...tr, id: trKey(lang, text) })
    if (value) found.set(text, value)
  }
  return found
}

function questionStrings(questions: Question[]): string[] {
  return questions.flatMap(q => [q.question, q.header, ...q.options.flatMap(o => [o.label, o.description])])
}

function nextStepStrings(step: NextStep | undefined): string[] {
  if (!step) return []
  const labels = step.actions.flatMap(a => ('label' in a ? [a.label] : []))
  return [step.recap, ...(step.ask ? [step.ask] : []), ...labels]
}

/** Parses the extraBody option; `error` set when it is not a JSON object. */
function parseExtraBody(raw: string): { value: Record<string, unknown>; error?: string } {
  if (!raw.trim()) return { value: {} }
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value: value as Record<string, unknown> }
  } catch {
    // falls through to the error
  }
  return { value: {}, error: 'extraBody is not a JSON object; ignored' }
}

function readProvider(raw: unknown): Provider {
  return raw === 'api' || raw === 'fake' ? raw : 'auto'
}

/** An unknown value falls back to qwen, what the default service (SiliconFlow) takes. */
function readThinkingFormat(raw: unknown): ThinkingFormat {
  return THINKING_FORMATS.find(f => f === raw) ?? 'qwen'
}

function readFileLanguage(raw: unknown): FileLanguage {
  return raw === 'en' ? 'en' : 'auto'
}

export const register: Register = (on, options) => {
  const s: Settings = {
    config: {
      provider: readProvider(options.provider),
      apiKey: String(options.apiKey ?? '').trim(),
      model: String(options.model ?? 'deepseek-ai/DeepSeek-V4.1-Flash').trim(),
      baseUrl: String(options.baseUrl ?? 'https://api.siliconflow.cn/v1').trim(),
      thinkingFormat: readThinkingFormat(options.thinkingFormat),
      extraBody: {},
    },
    configured: String(options.language ?? 'zh-CN').trim() || 'en',
    files: readFileLanguage(options.fileLanguage),
  }
  const extraBody = parseExtraBody(String(options.extraBody ?? '{}'))
  s.config.extraBody = extraBody.value

  on('session.start', async ($, e, next) => {
    if (extraBody.error) $.ui.toast(`language-bridge: ${extraBody.error}`)
    // A secret userConfig field has no row in /config; the environment is the
    // other way to give the key, and the field wins when both are set.
    if (!s.config.apiKey) {
      const fromEnv = (await $.env.get('LANGUAGE_BRIDGE_API_KEY')) ?? (await $.env.get('SILICONFLOW_API_KEY'))
      s.config.apiKey = (fromEnv ?? '').trim()
    }
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
      const translator = usesApi(s.config)
        ? `${s.config.model} via ${s.config.baseUrl} (thinking off: ${s.config.thinkingFormat})`
        : 'fake (no API key set)'
      return {
        text: `Language: ${lang}${isEnglish(lang) ? ' (translation off)' : ''}\nTranslator: ${translator}`,
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

  // Files: the engine composes the system prompt for every request, so a /lang
  // switch reaches the next one. The section sits after the cache boundary
  // (session scope) and is replaced, never repeated.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (s.files === 'en') return composed
    const lang = await currentLang($, s)
    if (isEnglish(lang)) return composed
    const sections = composed.sections.filter(sec => sec.id !== FILES_SECTION_ID)
    return { sections: [...sections, { id: FILES_SECTION_ID, text: filesSection(lang), scope: 'session' as const }] }
  }).catch(($, e, next) => next(e)) // a failure leaves the prompt as the engine made it

  // Input: the person's language → English, before the model reads it.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
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
      return refuse($, e.text, err)
    }
    if (normalize(english) === normalize(e.text)) return next(e)
    await $.state.set({ ...orig, id: hash(normalize(english)) }, e.text)
    return next({ ...e, text: english })
    // A failed hook sends nothing either; once the prompt went down, it stands.
  }).catch(($, e, next) =>
    next.called ? next(e) : refuse($, e.text, next.error.message ?? `translation ${next.error.kind}`),
  )

  // Name the session after the first prompt as typed, not its English: the
  // engine would title it from what the model reads.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const { value: done } = await $.state.get(titled)
    if (done) return result
    const lang = await currentLang($, s)
    if (isEnglish(lang)) return result
    const { value: typed } = await $.state.get({ ...orig, id: hash(normalize(e.prompt)) })
    const text = typed ?? (mayBeIn(lang, e.prompt) ? e.prompt : undefined)
    if (!text || text.trimStart().startsWith('/')) return result
    await $.state.set(titled, true)
    const line = text.replace(/\s+/g, ' ').trim()
    const title = line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line
    return { ...result, sessionTitle: title }
  }).catch(($, e, next) => next(e))

  // Show the prompt as typed, though the transcript stores its English, with
  // the English the model read dim beneath it: a mistranslated prompt turns
  // into wrong edits, so the person gets to see it. The row shows a preview;
  // the expanded view (ctrl+o) shows it whole.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { value } = await $.state.get({ ...orig, id: hash(normalize(e.props.text)) })
    if (!value) return next(e)
    const english = normalize(e.props.text)
    const typed = await next({ ...e, props: { ...e.props, text: value } })
    const { Box, Text } = $.ui.resolve(e)
    const shown = e.props.isExpanded ? english : preview(english)
    return (
      <Box flexDirection="column">
        {typed}
        <Text dimColor>→ {shown}</Text>
      </Box>
    )
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
      void translateBlocks($, s, texts)
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

  // The question dialog: start translating as it opens; it redraws when done.
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
    const questions = (e as unknown as { questions?: Question[] }).questions
    if (Array.isArray(questions)) {
      const texts = questionStrings(questions)
      $.clock.after(1, () => {
        void translateStrings($, s, texts)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a failure here never blocks the dialog

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = e.props.questions as Question[]
    if (!Array.isArray(questions)) return next(e)
    const t = await lookup($, s, questionStrings(questions))
    if (t.size === 0) return next(e)
    const translated = questions.map(q => {
      const header = t.get(q.header) ?? q.header
      return {
        ...q,
        question: t.get(q.question) ?? q.question,
        header: header.length <= MAX_HEADER_CHARS ? header : q.header,
        options: q.options.map(o => ({
          ...o,
          label: t.get(o.label) ?? o.label,
          description: t.get(o.description) ?? o.description,
        })),
      }
    })
    return next({ ...e, props: { ...e.props, questions: translated } })
  })

  // The wrap-up box (recap, question, reply buttons): translate once it ran.
  on('tool.call', { tool: 'WrapUp' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as { recap?: string; ask?: string }
    const step = (ran.result as { nextStep?: NextStep } | undefined)?.nextStep
    const texts = [...nextStepStrings(step), input.recap ?? '', input.ask ?? ''].filter(Boolean)
    if (texts.length > 0) {
      $.clock.after(1, () => {
        void translateStrings($, s, texts)
      })
    }
    return ran
  }).catch(($, e, next) => next(e)) // replays the call's own result

  on('ui.render', { component: 'ToolResult', props: { tool: 'WrapUp' } }, async ($, e, next) => {
    const output = e.props.output as { nextStep?: NextStep } | undefined
    const step = output?.nextStep
    if (!step) return next(e)
    const t = await lookup($, s, nextStepStrings(step))
    if (t.size === 0) return next(e)
    const nextStep: NextStep = {
      ...step,
      recap: t.get(step.recap) ?? step.recap,
      ...(step.ask ? { ask: t.get(step.ask) ?? step.ask } : {}),
      actions: step.actions.map(a => ('label' in a ? { ...a, label: t.get(a.label) ?? a.label } : a)),
    }
    return next({ ...e, props: { ...e.props, output: { ...output, nextStep } } })
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'WrapUp' } }, async ($, e, next) => {
    const input = e.props.input as { recap?: string; ask?: string } | undefined
    if (!input || typeof input.recap !== 'string') return next(e)
    const t = await lookup($, s, [input.recap, input.ask ?? ''])
    if (t.size === 0) return next(e)
    const rewritten = {
      ...input,
      recap: t.get(input.recap) ?? input.recap,
      ...(input.ask ? { ask: t.get(input.ask) ?? input.ask } : {}),
    }
    return next({ ...e, props: { ...e.props, input: rewritten } })
  })
}
