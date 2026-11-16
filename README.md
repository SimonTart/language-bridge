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
| `apiKey` | API key for the translation service. Stored in your system's secure storage (the Keychain on macOS), never in a settings file. | empty |
| `model` | Model name, as the service spells it. | `deepseek-ai/DeepSeek-V4.1-Flash` |
| `baseUrl` | API base URL. `/chat/completions` is appended to it. | `https://api.siliconflow.cn/v1` |

**Where to set them**

- **During install**, the settings screen asks for every field.
- **Afterwards**, `language`, `model` and `baseUrl` are rows in `/config`. A change there reloads the plugin.
- **API key from the environment**: if `apiKey` is empty, the plugin reads `SILICONFLOW_API_KEY`:
  ```
  export SILICONFLOW_API_KEY=sk-...   # e.g. in ~/.zshrc
  ```
- With no key at all, a **fake translator** is used: it only tags the text (`【zh-CN】…`), so you can see the pipeline working without spending anything.

**Getting a SiliconFlow key**: sign in at [cloud.siliconflow.cn](https://cloud.siliconflow.cn), open the API keys page in the console and create one.

**Using another service**: point `baseUrl` and `model` at any OpenAI-compatible endpoint, for example:

| Service | `baseUrl` | `model` |
|---|---|---|
| SiliconFlow (default) | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4.1-Flash` |
| DeepSeek | `https://api.deepseek.com` | a model from its `/models` list |
| OpenAI | `https://api.openai.com/v1` | e.g. `gpt-4o-mini` |

Each request currently also sends `enable_thinking: false`, which SiliconFlow uses to skip reasoning. Services that reject unknown parameters may refuse it; making this configurable is planned.

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
| The model's reply text, including the text between tool calls | Thinking, tool calls and their output, AskUserQuestion dialogs, plans, todo lists, subagent replies, reply summaries |

Within translated text, fenced code blocks, inline code, paths, commands and URLs are kept as written. If a translation changes the number of code fences, it is discarded and the original is shown. Prompts longer than 8,000 characters (pasted logs, files) are sent as typed.

## Cost

Each prompt costs one translation request, and each reply text block costs one more. With DeepSeek-V4.1-Flash on SiliconFlow (at the time of writing: ¥2 per million input tokens and ¥8 per million output tokens at peak, half price 02:00–08:00 China time), a typical turn costs well under ¥0.01.

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

Code: `hooks/register.ts` (hooks), `hooks/translate.ts` (API call and prompt), `hooks/text.ts` (hashing, language checks), `types/index.d.ts` (state contract).

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
| `apiKey` | 翻译服务的 API key，存进系统安全存储（macOS 是钥匙串），不写进配置文件 | 空 |
| `model` | 模型名 | `deepseek-ai/DeepSeek-V4.1-Flash` |
| `baseUrl` | 接口地址，后面会自动拼上 `/chat/completions` | `https://api.siliconflow.cn/v1` |

- **安装时**：设置页会依次让你填写以上字段。
- **安装后**：`language`、`model`、`baseUrl` 可以在 `/config` 里修改。
- **用环境变量提供 key**：`apiKey` 为空时会读取 `SILICONFLOW_API_KEY`，比如在 `~/.zshrc` 里加一行 `export SILICONFLOW_API_KEY=sk-...`。
- **没有 key 时**：使用假翻译，只给文本加个标记（`【zh-CN】…`），方便不花钱先验证流程。
- **获取硅基流动 key**：登录 [cloud.siliconflow.cn](https://cloud.siliconflow.cn)，在控制台的 API 密钥页面新建一个。
- **换别的服务**：把 `baseUrl` 和 `model` 改成对应服务的值即可，参考上面英文部分的表格。

### 用法

直接用你的语言输入。命令：`/lang` 查看当前设置；`/lang ja` 本会话切换到日语；`/lang en` 关闭翻译；`/lang reset` 恢复配置里的语言。

### 翻译范围

会翻译你输入的内容和模型的回复文字。思考过程、工具调用及其输出、提问框、计划、待办列表、子代理回复都不翻译。回复里的代码块、行内代码、路径、命令、URL 保持原样。
