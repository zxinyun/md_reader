// ===== AI Service: multi-provider LLM client =====
// Supports OpenAI-compatible, Gemini, Ollama, OpenRouter

function buildChatMessages(systemPrompt, userContent) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];
}

async function aiChat(messages, options) {
  const cfg = options || aiConfig;
  const provider = cfg.provider;

  if (provider === 'ollama') return ollamaChat(messages, cfg);
  if (provider === 'gemini') return geminiChat(messages, cfg);
  // OpenAI / OpenRouter / Custom (OpenAI-compatible) share the same API format
  return openaiChat(messages, cfg);
}

async function openaiChat(messages, cfg) {
  const url = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.openai.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: cfg.model || AI_PROVIDER_DEFAULTS.openai.model,
    messages,
    temperature: cfg.temperature ?? 0.3,
    max_tokens: cfg.maxTokens || 4096
  };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = '通用阅读器';
  }
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ': ' + (err || res.statusText));
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function geminiChat(messages, cfg) {
  const key = cfg.apiKey;
  if (!key) throw new Error('请配置 Gemini API Key');
  const model = cfg.model || AI_PROVIDER_DEFAULTS.gemini.model;
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.gemini.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/models/' + model + ':generateContent?key=' + encodeURIComponent(key);

  // Convert chat format to Gemini format
  const contents = [];
  let systemInstruction = null;
  for (const msg of messages) {
    if (msg.role === 'system') { systemInstruction = msg.content; continue; }
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
  }

  const body = { contents };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  body.generationConfig = {
    temperature: cfg.temperature ?? 0.3,
    maxOutputTokens: cfg.maxTokens || 4096
  };

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('Gemini API ' + res.status + ': ' + (err || res.statusText));
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

async function ollamaChat(messages, cfg) {
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.ollama.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/api/chat';
  const body = {
    model: cfg.model || AI_PROVIDER_DEFAULTS.ollama.model,
    messages: messages.map(m => ({ role: m.role === 'system' ? 'system' : m.role, content: m.content })),
    options: {
      temperature: cfg.temperature ?? 0.3,
      num_predict: cfg.maxTokens || 4096
    },
    stream: false
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('Ollama API ' + res.status + ': ' + (err || res.statusText));
  }
  const data = await res.json();
  return data.message?.content || '';
}

// ===== Summary =====
function buildSummaryPrompt(text, mode) {
  const modes = {
    tlDr: '请用2-3句话简要概括以下内容的核心要点。',
    detailed: '请详细总结以下内容，包含主要论点、论据和结论，分段落组织。',
    keyPoints: '请提取以下内容的关键要点，用简洁的列表形式呈现。',
    structured: '请按以下结构总结：\n1. 核心主题\n2. 主要观点\n3. 论据/数据\n4. 结论\n5. 个人见解/行动建议'
  };
  return (modes[mode] || modes.tlDr) + '\n\n内容如下：\n\n' + text;
}

async function summarizeText(text, mode) {
  const prompt = buildSummaryPrompt(text, mode || 'tlDr');
  const messages = buildChatMessages('你是一个专业的文档分析助手。请用中文回答。', prompt);
  return await aiChat(messages);
}

// ===== Format conversion =====
async function convertContent(text, targetFormat, sourceType) {
  const prompt = '请将以下' + (sourceType || '文档') + '转换为' + targetFormat + '格式。'
    + '保留原内容的完整信息、结构和数据。'
    + '直接输出转换结果，不要包含额外说明。\n\n'
    + text;
  const messages = buildChatMessages(
    '你是一个专业的格式转换助手。严格按目标格式输出，不要添加额外说明。',
    prompt
  );
  return await aiChat(messages);
}

// ===== Fetch available models =====
async function fetchModels(cfg) {
  cfg = cfg || aiConfig;
  const provider = cfg.provider;
  if (provider === 'ollama') return fetchOllamaModels(cfg);
  if (provider === 'gemini') return fetchGeminiModels(cfg);
  return fetchOpenaiModels(cfg); // OpenAI / OpenRouter / Custom
}

async function fetchOpenaiModels(cfg) {
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.openai.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/models';
  const headers = {};
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('获取模型列表失败 (' + res.status + ')');
  const data = await res.json();
  return (data.data || []).map(function(m) { return m.id; }).sort();
}

async function fetchOllamaModels(cfg) {
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.ollama.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/api/tags';
  const res = await fetch(url);
  if (!res.ok) throw new Error('获取模型列表失败 (' + res.status + ')');
  const data = await res.json();
  return (data.models || []).map(function(m) { return m.name; }).sort();
}

async function fetchGeminiModels(cfg) {
  const key = cfg.apiKey;
  if (!key) throw new Error('请先配置 API Key');
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.gemini.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/models?key=' + encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error('获取模型列表失败 (' + res.status + ')');
  const data = await res.json();
  return (data.models || []).map(function(m) { return m.name.replace(/^models\//, ''); }).sort();
}

// ===== Test connection =====
async function testConnection(cfg) {
  const testMessages = buildChatMessages('你是一个助手。', '请回复"连接成功"四个字。');
  const start = Date.now();
  const result = await aiChat(testMessages, cfg);
  return { ok: true, latency: Date.now() - start, response: result };
}