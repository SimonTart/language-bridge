# language-bridge

Use Claude Code in your own language. A Claude Code plugin (mod) that translates what you type into English before the model reads it, and shows the model's English replies translated back into your language.

[中文说明](#中文说明)

- **You type** in Chinese, Japanese, French, … → the model receives English.
- **The model replies** in English → the reply first appears in English, then turns into your language in place, about a second later, with the start of the English dim beneath it (the first two lines; ctrl+o shows the reply in English whole). A long reply is translated in pieces of whole paragraphs, each closed once it passes about 500 characters: each piece is sent as soon as the model has written it, so the start of the reply turns into your language while the rest is still being written, instead of the whole reply waiting for one long translation.
- **Only the display changes.** The stored conversation, the model's context and the ctrl+o transcript stay in English. Your own prompt is still shown the way you typed it, with the English the model received dim beneath it (the first two lines; ctrl+o shows it whole), so a mistranslation is caught before it turns into wrong edits.
- Translation goes through any **OpenAI-compatible chat completions API**. The default is [SiliconFlow](https://cloud.siliconflow.cn) with `deepseek-ai/DeepSeek-V4.1-Flash`, with thinking turned off, so a translation usually comes back in about a second.

> The Claude Code plugin API this uses is marked early access and may change between releases.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install language-bridge --marketplace SimonTart/language-bridge
```

Answer `y` to add the marketplace, choose a scope (user scope is the usual choice), then fill in the settings screen (see [Configuration](#configuration)).

From a shell:

```
claude plugin install language-bridge --marketplace SimonTart/language-bridge
```

## Configuration

| Field | What it is | Default |
|---|---|---|
| `language` | Your language as a BCP-47 code: `zh-CN`, `zh-TW`, `ja`, `ko`, `fr`, `de`, `es`, … Set `en` to turn translation off. | `zh-CN` |
| `provider` | `auto`: call the API when a key is set, else use the fake translator. `api`: always call the API (for keyless local servers such as Ollama). `fake`: only tag the text, for testing. | `auto` |
| `apiKey` | API key for the translation service. Stored in your system's secure storage (the Keychain on macOS), never in a settings file. | empty |
| `model` | Model name, as the service spells it. | `deepseek-ai/DeepSeek-V4.1-Flash` |
| `baseUrl` | API base URL. `/chat/completions` is appended unless the URL already ends with it. | `https://api.siliconflow.cn/v1` |
| `thinkingFormat` | How the service is told to skip thinking, so a translation comes back fast. Pick the one your service takes (see the table below); `none` sends nothing. | `qwen` |
| `extraBody` | A JSON object merged into every request body, for anything else a service needs. It may override the thinking field and `temperature`, never `model`, `stream` or `messages`. | `{}` |

**Where to set them**

- **During install**, the settings screen asks for every field.
- **Afterwards**, every field but `apiKey` is a row in `/config`. A change there reloads the plugin.
- **API key from the environment**: if `apiKey` is empty, the plugin reads `LANGUAGE_BRIDGE_API_KEY`, then `SILICONFLOW_API_KEY`:
  ```
  export LANGUAGE_BRIDGE_API_KEY=sk-...   # e.g. in ~/.zshrc
  ```
- With `provider` on `auto` and no key at all, a **fake translator** is used: it only tags the text (`【zh-CN】…`), so you can see the pipeline working without spending anything.

**Getting a SiliconFlow key**: sign in at [cloud.siliconflow.cn](https://cloud.siliconflow.cn), open the API keys page in the console and create one.

**Using another service**: every service here speaks OpenAI chat completions; they differ only in how thinking is turned off. Point `baseUrl` and `model` at the service and pick its `thinkingFormat`:

| Service | `provider` | `baseUrl` | `model` | `thinkingFormat` |
|---|---|---|---|---|
| SiliconFlow (default) | `auto` | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4.1-Flash` | `qwen` |
| DeepSeek | `auto` | `https://api.deepseek.com` | a model from its `/models` list | `deepseek` |
| Zhipu | `auto` | its OpenAI-compatible URL | its model name | `zai` |
| OpenRouter | `auto` | `https://openrouter.ai/api/v1` | a model ID from openrouter.ai/models | `openrouter` |
| OpenAI | `auto` | `https://api.openai.com/v1` | e.g. `gpt-4o-mini` | `none` |
| vLLM, SGLang (local) | `api` | e.g. `http://localhost:8000/v1` | the served model | `chat-template` |
| Ollama (local) | `api` | `http://localhost:11434/v1` | e.g. `qwen2.5:7b` | `none` |

What each value sends: `qwen` → `enable_thinking: false`; `deepseek`, `zai` → `thinking: {"type": "disabled"}`; `openrouter` → `reasoning: {"effort": "none"}`; `together` → `reasoning: {"enabled": false}`; `chat-template` → `chat_template_kwargs: {"enable_thinking": false}`; `none` → nothing. The names and fields follow [pi-ai](https://github.com/earendil-works/pi)'s `compat.thinkingFormat`. Should a model still put a `<think>…</think>` block at the start of its answer, the block is dropped.

## Usage

Just type in your language. Commands:

| Command | Does |
|---|---|
| `/lang` | Shows the current language and translator |
| `/lang ja` | Switches to Japanese for this session (earlier replies stay as they were) |
| `/lang en` | Turns translation off for this session |
| `/lang reset` | Goes back to the configured language |

## What is translated

| Translated | Not translated |
|---|---|
| Prompts you type (terminal, remote control, SDK hosts) | Slash commands and skills, task notifications, messages from other agents |
| The model's reply text, including the text between tool calls | Thinking, tool calls and their output, plans, todo lists, subagent replies, reply summaries, files the model writes |
| Question dialogs (AskUserQuestion): questions, headers, options and their descriptions | Option previews |
| The wrap-up box: recap, question and reply buttons | The app's own buttons |
| The session title, set from your first prompt as typed | |

**Code is never sent for translation.** Fenced code blocks are swapped for placeholders before the request and put back byte for byte afterwards; a reply that is only code costs no request. If a placeholder does not come back exactly once, the translation is discarded and the original is shown. Inline code, paths, commands and URLs are kept by the prompt, which also wraps the text in `<source>` tags so text that reads like an instruction is translated, not followed. Prompts longer than 8,000 characters (pasted logs, files) are sent as typed.

**If translating a prompt fails** (network error, bad key, a service error), nothing is sent: the reason is shown and your text is put back in the prompt box, so you can retry or edit it.

Dialogs and the wrap-up box first appear in English and switch in place once translated. Clicking a translated reply button puts the translated text in the prompt, which is translated back to English when you send it.

## Cost

Each prompt costs one translation request, each reply text block one more (a long one, one per piece of about 500 characters), and each question dialog or wrap-up box one more. With DeepSeek-V4.1-Flash on SiliconFlow (at the time of writing: ¥2 per million input tokens and ¥8 per million output tokens at peak, half price 02:00–08:00 China time), a typical turn costs well under ¥0.01.

## Known limits

- Right-to-left languages (Arabic, Hebrew) may not display correctly in a terminal.
- Each prompt waits for one translation (about a second) before it reaches the model.
- A long reply is translated piece by piece, each without seeing the others, so a term may now and then be worded differently from one piece to the next.
- `/lang` lasts for the session only; set `language` in `/config` to change the default.

## Development

```
claude --plugin-dir /path/to/language-bridge   # run it from the folder; edits hot-reload
claude plugin validate .                       # check the manifest and hooks module
claude plugin test .                           # run tests/*.test.tsx
```

Code: `hooks/register.tsx` (hooks), `hooks/translate.ts` (API call and prompt), `hooks/text.ts` (hashing, language checks), `types/index.d.ts` (state contract).

## License

[MIT](LICENSE)

---

## 中文说明

在 Claude Code 里用自己的语言交流。你打的话会先翻译成英文再交给模型；模型的英文回复会原地显示成你的语言。

- **只改显示**：保存的对话、模型的上下文、ctrl+o 里看到的记录都还是英文。你自己的输入仍按原样显示，下面用淡色附上模型实际收到的英文（只显示前两行，ctrl+o 里显示全文），译错了能及时发现。模型的回复翻译后，下面同样用淡色附上英文原文的前两行，ctrl+o 里可以看到完整的英文回复。
- **长回复分段翻译**：长回复按整段切分，每段满约 500 字符就在下一个段落间隔处切开，模型每写完一段就立刻送去翻译，前面的内容先变成你的语言，不用等整段回复写完再一次性翻译。各段分别翻译，个别术语在不同段里的译法偶尔会不一致。
- **翻译服务**：任何 OpenAI 兼容的 chat completions 接口都可以。默认是硅基流动的 `deepseek-ai/DeepSeek-V4.1-Flash`，关闭了思考，一般一秒左右返回。

### 安装

在 Claude Code 终端会话里输入：

```
/plugin install language-bridge --marketplace SimonTart/language-bridge
```

按 `y` 添加插件市场，选择安装范围（一般选 user），然后在设置页填写配置。

### 配置

| 字段 | 说明 | 默认值 |
|---|---|---|
| `language` | 你的语言，BCP-47 代码，如 `zh-CN`、`ja`、`ko`、`fr`。填 `en` 表示关闭翻译 | `zh-CN` |
| `apiKey` | 翻译服务的 API key，存进系统安全存储（macOS 是钥匙串），不写进配置文件 | 空 |
| `model` | 模型名 | `deepseek-ai/DeepSeek-V4.1-Flash` |
| `baseUrl` | 接口地址，后面会自动拼上 `/chat/completions` | `https://api.siliconflow.cn/v1` |
| `thinkingFormat` | 用哪种方式让服务关闭思考，翻译才快。按服务选择，见下文 | `qwen` |

- **安装时**：设置页会依次让你填写以上字段。
- **安装后**：除 `apiKey` 外的字段都可以在 `/config` 里修改。
- **`provider`**：`auto` 表示有 key 就调接口、没有就用假翻译；`api` 表示总是调接口（适合不需要 key 的本地服务，如 Ollama）；`fake` 表示只用假翻译。
- **`thinkingFormat`**：各家服务都是 OpenAI 兼容接口，区别只在怎么关思考。`qwen`（硅基流动、通义千问）发 `enable_thinking: false`；`deepseek`、`zai`（DeepSeek、智谱）发 `thinking: {"type": "disabled"}`；`openrouter` 发 `reasoning: {"effort": "none"}`；`together` 发 `reasoning: {"enabled": false}`；`chat-template`（vLLM、SGLang）发 `chat_template_kwargs: {"enable_thinking": false}`；`none`（OpenAI、Ollama）什么都不发。模型若仍在回答开头带 `<think>…</think>`，会被去掉。
- **`extraBody`**：一段 JSON，会合并进每个请求体，用来传服务商的其他参数，默认 `{}`。它可以覆盖关思考的字段和 `temperature`，但不能覆盖 `model`、`stream`、`messages`。
- **用环境变量提供 key**：`apiKey` 为空时依次读取 `LANGUAGE_BRIDGE_API_KEY`、`SILICONFLOW_API_KEY`，比如在 `~/.zshrc` 里加一行 `export LANGUAGE_BRIDGE_API_KEY=sk-...`。
- **没有 key 时**：`provider` 为 `auto` 时使用假翻译，只给文本加个标记（`【zh-CN】…`），方便不花钱先验证流程。
- **获取硅基流动 key**：登录 [cloud.siliconflow.cn](https://cloud.siliconflow.cn)，在控制台的 API 密钥页面新建一个。
- **换别的服务**：把 `baseUrl`、`model` 改成对应服务的值，再选好 `thinkingFormat`，参考上面英文部分的表格。

### 用法

直接用你的语言输入。命令：`/lang` 查看当前设置；`/lang ja` 本会话切换到日语；`/lang en` 关闭翻译；`/lang reset` 恢复配置里的语言。

### 翻译范围

会翻译：你输入的内容、模型的回复文字、提问框（问题、标签、选项和选项说明）、工作结束时的小结框（小结、问题、回复按钮），以及会话标题（取你第一句话的原文）。

不翻译：思考过程、工具调用及其输出、计划、待办列表、子代理回复，以及模型写入的文件（插件不干预文件内容和语言）。

代码块不会发给翻译服务：发送前替换成占位符，翻译完再原样放回；整段都是代码的回复不发请求。行内代码、路径、命令、URL 由提示词要求保持原样。

**输入翻译失败时**（网络错误、key 不对、服务报错）不会发送：会显示原因，并把你的原文放回输入框，方便重试或修改。
