import type { EngineInterface } from 'claude-code'

import { fenceCount, isEnglish, languageName } from './text'

export type TranslatorConfig = {
  apiKey: string
  model: string
  baseUrl: string
}

function systemPrompt(to: string): string {
  const target = languageName(to)
  return [
    `You are a translation engine. Translate the user's message into ${target}.`,
    `If the message is already written in ${target}, return it exactly as given, unchanged.`,
    'Keep the markdown structure exactly: headings, lists, tables, emphasis, links.',
    'Do not translate fenced code blocks, inline code, file paths, shell commands, URLs, identifiers, or error messages quoted verbatim.',
    'Output only the translation, with no notes, quotes, or explanations.',
  ].join('\n')
}

/**
 * Translates `text` into `to`. Returns the text unchanged when it is already
 * in `to`. Throws on a network or API error, or when the translation broke a
 * code fence; the caller keeps the original then.
 */
export async function translate(
  $: EngineInterface,
  config: TranslatorConfig,
  text: string,
  to: string,
): Promise<string> {
  const out = config.apiKey ? await chatCompletion($, config, text, to) : fake(text, to)
  if (fenceCount(out) !== fenceCount(text)) {
    throw new Error('translation changed the number of code fences')
  }
  return out
}

/** No key: tag the text, so the pipeline can be watched without a provider. */
function fake(text: string, to: string): string {
  return isEnglish(to) ? `[en] ${text}` : `【${to}】${text}`
}

// One OpenAI-compatible chat completion (SiliconFlow by default), thinking off
// so a translation comes back in about a second.
async function chatCompletion(
  $: EngineInterface,
  config: TranslatorConfig,
  text: string,
  to: string,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await $.http.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      stream: false,
      enable_thinking: false,
      messages: [
        { role: 'system', content: systemPrompt(to) },
        { role: 'user', content: text },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`translate HTTP ${res.status}: ${res.text.slice(0, 200)}`)
  }
  const data = JSON.parse(res.text) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('the translator returned no text')
  }
  return content.trim()
}
