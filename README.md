# language-bridge

Use Claude Code in your own language. A Claude Code plugin (mod) that translates what you type into English before the model reads it, and shows the model's English replies translated back into your language.

[中文说明](#中文说明)

- **You type** in Chinese, Japanese, French, … → the model receives English.
- **The model replies** in English → the reply first appears in English, then turns into your language in place, about a second later.
- **Only the display changes.** The stored conversation, the model's context and the ctrl+o transcript stay in English. Your own prompt is still shown the way you typed it.
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
| `fileLanguage` | `auto`: ask the model to write new documents in your language (see [Files the model writes](#files-the-model-writes)). `en`: say nothing; files are written in English. | `auto` |
| `apiKey` | API key for the translation service. Stored in your system's secure storage (the Keychain on macOS), never in a settings file. | empty |
| `model` | Model name, as the service spells it. | `deepseek-ai/DeepSeek-V4.1-Flash` |
| `baseUrl` | API base URL. `/chat/completions` is appended unless the URL already ends with it. | `https://api.siliconflow.cn/v1` |
| `extraBody` | A JSON object merged into every request body, for a service's own parameters. The default turns off SiliconFlow's thinking; clear it (`{}`) for services that reject unknown fields. | `{"enable_thinking": false}` |

**Where to set them**

- **During install**, the settings screen asks for every field.
- **Afterwards**, every field but `apiKey` is a row in `/config`. A change there reloads the plugin.
- **API key from the environment**: if `apiKey` is empty, the plugin reads `LANGUAGE_BRIDGE_API_KEY`, then `SILICONFLOW_API_KEY`:
  ```
  export LANGUAGE_BRIDGE_API_KEY=sk-...   # e.g. in ~/.zshrc
  ```
- With `provider` on `auto` and no key at all, a **fake translator** is used: it only tags the text (`【zh-CN】…`), so you can see the pipeline working without spending anything.

**Getting a SiliconFlow key**: sign in at [cloud.siliconflow.cn](https://cloud.siliconflow.cn), open the API keys page in the console and create one.

**Using another service**: point `baseUrl` and `model` at any OpenAI-compatible endpoint, for example:

| Service | `provider` | `baseUrl` | `model` | `extraBody` |
|---|---|---|---|---|
| SiliconFlow (default) | `auto` | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4.1-Flash` | `{"enable_thinking": false}` |
| DeepSeek | `auto` | `https://api.deepseek.com` | a model from its `/models` list | `{}` |
| OpenAI | `auto` | `https://api.openai.com/v1` | e.g. `gpt-4o-mini` | `{}` |
| Ollama (local) | `api` | `http://localhost:11434/v1` | e.g. `qwen2.5:7b` | `{}` |

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
| The model's reply text, including the text between tool calls | Thinking, tool calls and their output, plans, todo lists, subagent replies, reply summaries |
| Question dialogs (AskUserQuestion): questions, headers, options and their descriptions | Option previews |
| The wrap-up box: recap, question and reply buttons | The app's own buttons |
| The session title, set from your first prompt as typed | |
| Files the model writes: not translated, but written in the right language (below) | |

**Code is never sent for translation.** Fenced code blocks are swapped for placeholders before the request and put back byte for byte afterwards; a reply that is only code costs no request. If a placeholder does not come back exactly once, the translation is discarded and the original is shown. Inline code, paths, commands and URLs are kept by the prompt, which also wraps the text in `<source>` tags so text that reads like an instruction is translated, not followed. Prompts longer than 8,000 characters (pasted logs, files) are sent as typed.

**If translating a prompt fails** (network error, bad key, a service error), nothing is sent: the reason is shown and your text is put back in the prompt box, so you can retry or edit it.

Dialogs and the wrap-up box first appear in English and switch in place once translated. Clicking a translated reply button puts the translated text in the prompt, which is translated back to English when you send it.

## Files the model writes

A file is real output: the model reads it back and edits it, so translating it after the write would leave the disk out of step with what the model remembers. Instead the plugin adds one short section to the system prompt telling the model which language to write **new** files in; files that already exist keep their language. For a new file it picks the first rule that applies:

1. You asked for a language, an English version or a bilingual document: it does that.
2. A project file (README, docs, changelog, code comments): it follows the language the project's existing files use, English when there are none.
3. Otherwise a document (a plan, report, notes, summary, any other Markdown file) is in your language.

Replies stay in English and are translated as before. The section is part of the system prompt, not added to each message: one copy, after the prompt cache boundary, replaced when `/lang` switches language. Set `fileLanguage` to `en` to turn it off.

## Cost

Each prompt costs one translation request, each reply text block one more, and each question dialog or wrap-up box one more. With DeepSeek-V4.1-Flash on SiliconFlow (at the time of writing: ¥2 per million input tokens and ¥8 per million output tokens at peak, half price 02:00–08:00 China time), a typical turn costs well under ¥0.01.

## Known limits

- Right-to-left languages (Arabic, Hebrew) may not display correctly in a terminal.
- Each prompt waits for one translation (about a second) before it reaches the model.
- `/lang` lasts for the session only; set `language` in `/config` to change the default.

## Development

```
claude --plugin-dir /path/to/language-bridge   # run it from the folder; edits hot-reload
claude plugin validate .                       # check the manifest and hooks module
claude plugin test .                           # run tests/*.test.tsx
```

Code: `hooks/register.ts` (hooks), `hooks/translate.ts` (API call and prompt), `hooks/files.ts` (the files section of the system prompt), `hooks/text.ts` (hashing, language checks), `types/index.d.ts` (state contract).

## License

[MIT](LICENSE)

---

## 中文说明

在 Claude Code 里用自己的语言交流。你打的话会先翻译成英文再交给模型；模型的英文回复会原地显示成你的语言。

- **只改显示**：保存的对话、模型的上下文、ctrl+o 里看到的记录都还是英文。你自己的输入仍按原样显示。
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
| `fileLanguage` | `auto`：让模型用你的语言写新建的文档；`en`：不干预，文件用英文写 | `auto` |
| `apiKey` | 翻译服务的 API key，存进系统安全存储（macOS 是钥匙串），不写进配置文件 | 空 |
| `model` | 模型名 | `deepseek-ai/DeepSeek-V4.1-Flash` |
| `baseUrl` | 接口地址，后面会自动拼上 `/chat/completions` | `https://api.siliconflow.cn/v1` |

- **安装时**：设置页会依次让你填写以上字段。
- **安装后**：除 `apiKey` 外的字段都可以在 `/config` 里修改。
- **`provider`**：`auto` 表示有 key 就调接口、没有就用假翻译；`api` 表示总是调接口（适合不需要 key 的本地服务，如 Ollama）；`fake` 表示只用假翻译。
- **`extraBody`**：一段 JSON，会合并进每个请求体，用来传服务商自己的参数。默认值 `{"enable_thinking": false}` 用于关闭硅基流动的思考；换成不认识这个字段的服务时改成 `{}`。
- **用环境变量提供 key**：`apiKey` 为空时依次读取 `LANGUAGE_BRIDGE_API_KEY`、`SILICONFLOW_API_KEY`，比如在 `~/.zshrc` 里加一行 `export LANGUAGE_BRIDGE_API_KEY=sk-...`。
- **没有 key 时**：`provider` 为 `auto` 时使用假翻译，只给文本加个标记（`【zh-CN】…`），方便不花钱先验证流程。
- **获取硅基流动 key**：登录 [cloud.siliconflow.cn](https://cloud.siliconflow.cn)，在控制台的 API 密钥页面新建一个。
- **换别的服务**：把 `baseUrl` 和 `model` 改成对应服务的值即可，参考上面英文部分的表格。

### 用法

直接用你的语言输入。命令：`/lang` 查看当前设置；`/lang ja` 本会话切换到日语；`/lang en` 关闭翻译；`/lang reset` 恢复配置里的语言。

### 模型写的文件

文件是真实产物，模型之后还会读、会改，所以不在写完后翻译，而是在系统提示里加一小段规则，让模型写**新文件**时就用对语言；已有文件保持原来的语言。新文件按顺序取第一条适用的：

1. 你明确要求了某种语言、英文版或中英双语：照做。
2. 项目文件（README、文档、changelog、代码注释）：跟随项目里同类文件的语言，没有可参照的就用英文。
3. 其余文档（方案、报告、笔记、总结等 Markdown 文件）：用你的语言。

回复仍是英文、照常翻译。这段规则在系统提示里只有一份，不会每条消息追加；`/lang` 换语言时直接替换。`fileLanguage` 设为 `en` 可关闭。

### 翻译范围

会翻译：你输入的内容、模型的回复文字、提问框（问题、标签、选项和选项说明）、工作结束时的小结框（小结、问题、回复按钮），以及会话标题（取你第一句话的原文）。

不翻译：思考过程、工具调用及其输出、计划、待办列表、子代理回复。

模型写入的文件不翻译，但新建的文档会直接用你的语言写，见上文“模型写的文件”。

代码块不会发给翻译服务：发送前替换成占位符，翻译完再原样放回；整段都是代码的回复不发请求。行内代码、路径、命令、URL 由提示词要求保持原样。

**输入翻译失败时**（网络错误、key 不对、服务报错）不会发送：会显示原因，并把你的原文放回输入框，方便重试或修改。
