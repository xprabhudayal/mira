// runE2BAgent.ts
import { Sandbox } from '@e2b/code-interpreter';
import { Sandbox as SandboxMCP } from 'e2b';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import {
  E2BAgentInput,
  E2BAgentOutput,
  Message,
  ReportData,
} from './types';

// -------------------- Type Extensions for MCP --------------------
// MCP helpers are relatively new; TS types may lag the runtime.
// Keep this loose so we don't fight the type system during development.
type MCPSandboxOptions = {
  mcp?: {
    exa?: {
      apiKey: string;
    };
  };
  timeoutMs?: number;
};

type MCPSandbox = any;

// -------------------- Helpers --------------------

function extractResponseOutputText(resp: any): string {
  if (!resp) return '';

  // Preferred field from Responses API
  if (resp.output_text) {
    return String(resp.output_text).trim();
  }

  const parts: string[] = [];
  const push = (val: any) => {
    if (val) parts.push(String(val));
  };

  const scanContent = (content: any) => {
    if (!content) return;
    if (typeof content === 'string') {
      push(content);
      return;
    }
    if (Array.isArray(content)) {
      content.forEach(scanContent);
      return;
    }
    if (content.type === 'output_text' && content.text) {
      push(content.text);
    }
    if (content.output_text?.text) {
      push(content.output_text.text);
    }
    if (content.text?.value) {
      push(content.text.value);
    }
    if (content.text) {
      push(content.text);
    }
  };

  if (Array.isArray(resp.output)) {
    resp.output.forEach((chunk: any) => {
      if (chunk?.output_text) push(chunk.output_text);
      if (chunk?.output_text?.text) push(chunk.output_text.text);
      scanContent(chunk.content);
    });
  }

  return parts.join('\n').trim();
}

async function uploadCsvToSandbox(
  sandbox: Sandbox,
  csvBuffer: Buffer,
  csvPath: string,
) {
  console.log(`   ⏳ Uploading ${csvBuffer.length} bytes to sandbox...`);

  const arrayBuffer = new ArrayBuffer(csvBuffer.byteLength);
  const view = new Uint8Array(arrayBuffer);
  view.set(csvBuffer);

  await sandbox.files.write(csvPath, arrayBuffer);

  console.log('   ✅ Upload complete');
}

function formatConversationHistory(history: Message[]): string {
  if (!history || history.length === 0) return '';
  return history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

function extractUrls(text: string): string[] {
  if (!text) return [];
  const regex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(regex);
  return matches ? Array.from(new Set(matches)) : [];
}

function parseStructuredReport(text: string): ReportData | undefined {
  if (!text) return undefined;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/```$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') return undefined;

    const coerceArray = (v: any) =>
      Array.isArray(v) ? v.map((x) => String(x)) : [];

    const charts = Array.isArray((parsed as any).charts)
      ? (parsed as any).charts.map((c: any, idx: number) => ({
          title: String(c?.title || `Chart ${idx + 1}`),
          bullets: coerceArray(c?.bullets),
        }))
      : [];

    const report: ReportData = {
      summary: String((parsed as any).summary || ''),
      kpis: coerceArray((parsed as any).kpis),
      charts,
      externalContext:
        coerceArray((parsed as any).externalContext) ||
        coerceArray((parsed as any).external_context),
      nextSteps:
        coerceArray((parsed as any).nextSteps) ||
        coerceArray((parsed as any).next_steps),
      additionalDetails:
        coerceArray((parsed as any).additionalDetails) ||
        coerceArray((parsed as any).additional_details),
    };

    return report;
  } catch (err) {
    return undefined;
  }
}

/**
 * Use Exa through E2B Docker MCP to pull context for user-provided URLs.
 * This spins up a dedicated MCP sandbox, calls Exa via MCP, and returns a
 * structured text summary to inject into the main agent as system context.
 */
async function fetchExternalContextViaMCP(
  userMessage: string,
  genAI: GoogleGenerativeAI,
): Promise<string> {
  const urls = extractUrls(userMessage || '');
  if (!urls.length) {
    console.log('   🔎 No URLs detected for Exa MCP.');
    return '';
  }

  if (!process.env.EXA_API_KEY) {
    console.warn(
      '   ⚠️ EXA_API_KEY missing. Skipping Exa MCP context (Docker).',
    );
    return '';
  }

  console.log('   🔎 Detected URLs for Exa MCP:', urls);

  // Spin up an E2B sandbox WITH Exa MCP server configured
  console.log('   🐳 Creating E2B MCP sandbox for Exa...');
  const mcpSandbox = (await SandboxMCP.create({
    mcp: {
      exa: {
        apiKey: process.env.EXA_API_KEY!,
      },
    },
    timeoutMs: 600_000, // 10 minutes
  } as MCPSandboxOptions)) as MCPSandbox;

  console.log('   ✅ MCP sandbox created');

  // Guard for older e2b versions / missing MCP helpers
  const hasGetMcpUrl = typeof mcpSandbox.getMcpUrl === 'function';
  const hasGetMcpToken = typeof mcpSandbox.getMcpToken === 'function';

  if (!hasGetMcpUrl || !hasGetMcpToken) {
    console.warn(
      '   ⚠️ MCP helpers (getMcpUrl/getMcpToken) are not available on this Sandbox instance.\n' +
        '      This usually means your `e2b` SDK version is too old for MCP.\n' +
        '      Exa *is* being configured on the Docker side, but we cannot wire it into OpenAI Responses.\n' +
        '      -> Skipping external Exa context for this run.',
    );
    try {
      await mcpSandbox.kill?.();
    } catch (e) {
      console.error('   ⚠️ MCP cleanup warning:', e);
    }
    return '';
  }

  console.log(`      MCP URL: ${mcpSandbox.getMcpUrl()}`);

  try {
    // For now, we'll skip the MCP-based Exa research with Gemini
    // as Gemini doesn't have the same MCP integration as OpenAI Responses API
    // This can be enhanced later with direct Exa API calls
    console.log('   ⚠️ Exa MCP integration with Gemini not yet implemented.');
    console.log('   ℹ️ Skipping external context for this run.');
    return '';
  } catch (err) {
    console.error('   ❌ Exa MCP research failed:', err);
    return '';
  } finally {
    console.log('   🐳 Cleaning up MCP sandbox...');
    await mcpSandbox
      .kill()
      .catch((e: any) => console.error('   ⚠️ MCP cleanup warning:', e));
  }
}

// -------------------- Main Agent --------------------

export async function runE2BAgent(
  input: E2BAgentInput,
): Promise<E2BAgentOutput> {
  console.log('\n🚀 --- STARTING AGENT RUN (Gemini 2.5 Flash, E2B + Exa MCP) ---');

  if (!process.env.E2B_API_KEY) throw new Error('E2B_API_KEY missing');
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY missing');

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

  // 1) OPTIONAL: external context via Exa MCP (Docker)
  const externalContext = await fetchExternalContextViaMCP(
    input.userMessage,
    genAI,
  );

  let sandbox: Sandbox | undefined;
  const allCharts: Buffer[] = [];

  try {
    const rawTemplate = process.env.E2B_TEMPLATE_ID?.trim();
    const hasTemplate = !!rawTemplate;

    console.log(
      `   🏗️ Requesting Code-Interpreter Sandbox (Template: ${
        hasTemplate ? rawTemplate : 'default'
      })...`,
    );
    const startedAt = Date.now();

    let sandboxPromise: Promise<Sandbox>;
    if (hasTemplate) {
      sandboxPromise = Sandbox.create(rawTemplate!, {
        apiKey: process.env.E2B_API_KEY!,
        timeoutMs: 300_000,
        requestTimeoutMs: 30_000,
      });
    } else {
      sandboxPromise = Sandbox.create({
        apiKey: process.env.E2B_API_KEY!,
        timeoutMs: 300_000,
        requestTimeoutMs: 30_000,
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Sandbox creation timed out locally (30s)')),
        30_000,
      ),
    );

    sandbox = (await Promise.race([
      sandboxPromise,
      timeoutPromise,
    ])) as Sandbox;

    const setupTime = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `   ✅ Sandbox Ready in ${setupTime}s (ID: ${sandbox.sandboxId})`,
    );

    const csvPath = '/home/user/data.csv';
    await uploadCsvToSandbox(sandbox, input.csvBuffer, csvPath);

    // -------------------- Tools Schema for Gemini --------------------
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'run_python',
            description: `Run Python code to analyze the CSV and generate charts.

- The CSV is at '${csvPath}'.
- ALWAYS start by:
  import pandas as pd
  df = pd.read_csv('${csvPath}')
- For complex analysis, you MAY:
  - Create SQLite DB with sqlite3
  - df.to_sql('data', conn, if_exists='replace', index=False)
- Use matplotlib.pyplot as plt and ALWAYS call plt.show() for charts.`,
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                code: {
                  type: SchemaType.STRING,
                  description: 'The Python code to execute in a single cell.',
                },
                reasoning: {
                  type: SchemaType.STRING,
                  description:
                    'Brief explanation of what this code is trying to do.',
                },
              },
              required: ['code', 'reasoning'],
            },
          },
        ],
      },
    ];

    // -------------------- System Prompt --------------------

    const systemPrompt = `
You are an advanced **Data Analyst & Report Builder Agent** working inside an E2B code-interpreter sandbox.

You can:
- Run Python code on the CSV file at '${csvPath}' using the "run_python" tool.
- Optionally build a SQLite database from the CSV for complex SQL-style analysis.

🚨 VERY IMPORTANT:
- Your **first response MUST be a call to the \`run_python\` tool**.
- That first \`run_python\` call **must**:
  - Import pandas as pd
  - Load the CSV from '${csvPath}' into a DataFrame named \`df\`
  - Print df.head(), df.info(), and df.describe(include="all").
- After that:
  - You MUST call \`run_python\` again to compute metrics / aggregations.
  - You MUST call \`run_python\` again to generate at least **3 charts** using matplotlib and call plt.show().

You are NOT allowed to finish with a natural language answer until at least 3 charts have been generated.

STRICT WORKFLOW:

1. EXPLORE (MANDATORY)
   - Load CSV into df.
   - Inspect head, info, describe.

2. METRICS / SQL-LIKE ANALYSIS (MANDATORY, KPI-FOCUSED)
   - Compute relevant aggregates, group-bys, KPIs, etc.
   - Always try to surface concrete **numeric KPIs**, e.g.:
     - Totals (e.g., total bookings, total revenue)
     - Averages (e.g., avg nightly rate, avg party size)
     - Rates / percentages (e.g., occupancy rate, cancellation rate, share of top categories)
     - Rankings (e.g., top 5 dates, top 5 categories/items by volume or value)
   - Prefer numbers over vague descriptions. Every major point in your final report should be backed by at least one number.

3. VISUALIZE (MANDATORY)
   - Create at least 3 meaningful charts with matplotlib (and optionally seaborn).
   - Always call plt.show().
   - Prefer a mix of:
     - Time series or trend chart (if there is a date/time column),
     - Distribution chart (histogram / boxplot),
     - Category-wise comparison (bar chart).

4. CONTEXT (OPTIONAL BUT RECOMMENDED)
   - The system may provide **"External context from user-provided links (via Exa MCP)"** as an additional system message.
   - When present, you MUST:
     - Read it carefully.
     - Incorporate any relevant definitions, benchmarks, or domain context into your analysis and final report.
     - Where useful, compare your computed KPIs against any benchmarks mentioned.

5. FINAL REPORT (MANDATORY, CONCISE & STRUCTURED)
   - Only after charts exist, produce a **short, structured report** with these sections (in order):
     - **Key KPIs (4–7 bullets, numbers only, max 15 words each)**.
     - **Chart 1 – [Title]** (2–3 bullets: what it shows, 1–2 numeric insights, 1 takeaway).
     - **Chart 2 – [Title]** (same format).
     - **Chart 3 – [Title]** (same format; if extra charts, include similarly but stay brief).
     - **External Context** (only if provided; 2–4 bullets tying benchmarks/definitions to the data).
     - **Next Steps** (3 bullets, action-oriented, <=15 words).
   - You **must provide at least as many insight/chart blocks as charts generated**; never leave placeholders like “---”.
   - Your final message MUST include the headings for every chart you generated (e.g., “Chart 1 – ...”, “Chart 2 – ...”, “Chart 3 – ...”) with 2–3 bullets each. If any are missing, do not stop; continue until they are present.
   - Do **NOT** repeat the same numbers across sections. Avoid long paragraphs; keep everything in compact bullets.
   - Keep the overall report tight—no filler sentences or redundant restatements.
   - At the very end, return **ONLY valid JSON (no markdown fences)** with this schema:
     {
       "summary": string,
       "kpis": string[],
       "charts": [{"title": string, "bullets": string[]}],
       "externalContext": string[],
       "nextSteps": string[],
       "additionalDetails": string[]
     }
     - Ensure arrays are the same length as the generated content (e.g., one chart entry per chart). No extra commentary.

If you attempt to answer in natural language before generating charts, the orchestrator will ask you to continue.
`.trim();

    const historyText = formatConversationHistory(input.conversationHistory);
    const combinedPrompt = historyText
      ? `Conversation so far:\n${historyText}\n\nCurrent user request:\n${input.userMessage}`
      : input.userMessage;

    // -------------------- Chat Loop with Gemini --------------------

    // Use stable Gemini 2.0 Flash model (not experimental)
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    console.log(`   🤖 Using Gemini model: ${modelName}`);
    
    const model = genAI.getGenerativeModel({
      model: modelName,
      tools,
    });

    const chat = model.startChat({
      history: [],
    });

    // Build initial prompt with system context
    let initialPrompt = systemPrompt + '\n\n';
    if (externalContext) {
      initialPrompt +=
        'External context from user-provided links (via Exa MCP, running inside E2B Docker):\n\n' +
        externalContext +
        '\n\n';
    }
    initialPrompt += combinedPrompt;

    let stepCount = 0;
    let finalSummary = '';

    const MIN_CHARTS = 3;
    const MAX_ROUNDS = 10;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      console.log(`\n   🔁 LLM ROUND ${round + 1}`);

      const result = await chat.sendMessage(
        round === 0 ? initialPrompt : '',
      );
      const response = result.response;
      stepCount++;

      console.log(`   📍 STEP ${stepCount}`);

      const functionCalls = response.functionCalls();

      // 1) Handle tool calls (Python in E2B)
      if (functionCalls && functionCalls.length > 0) {
        console.log(`      🛠️ Tool calls (${functionCalls.length})`);

        const functionResponseParts: Array<{
          functionResponse: { name: string; response: any };
        }> = [];

        for (const functionCall of functionCalls) {
          const toolName = functionCall.name;
          const args = functionCall.args as Record<string, unknown>;

          console.log(`      🔧 Executing tool "${toolName}"`);

          try {
            if (toolName === 'run_python') {
              const code = args.code as string;
              const reasoning = (args.reasoning as string) || 'No reasoning provided';

              console.log(`         🐍 Reasoning: ${reasoning.slice(0, 200)}`);
              const exec = await sandbox!.runCode(code);

              console.log(
                '         📦 Python exec summary:',
                JSON.stringify(
                  {
                    error: exec.error,
                    resultsCount: exec.results?.length ?? 0,
                    stdoutLines: exec.logs?.stdout?.length ?? 0,
                    stderrLines: exec.logs?.stderr?.length ?? 0,
                  },
                  null,
                  2,
                ),
              );

              let chartsInStep = 0;
              if (exec.results && exec.results.length > 0) {
                for (const res of exec.results) {
                  if (res.png) {
                    allCharts.push(Buffer.from(res.png, 'base64'));
                    chartsInStep++;
                  }
                }
              }

              let toolResultContent: Record<string, unknown>;
              if (exec.error) {
                toolResultContent = {
                  status: 'error',
                  error_name: exec.error.name,
                  error_value: exec.error.value,
                  traceback: exec.error.traceback,
                  charts_generated: chartsInStep,
                };
              } else {
                const stdout = (exec.logs?.stdout || []).join('\n');
                const textResults = (exec.results || [])
                  .map((r) => r.text)
                  .filter(Boolean)
                  .join('\n');

                toolResultContent = {
                  status: 'success',
                  stdout: stdout.slice(0, 2000),
                  data_preview: textResults.slice(0, 2000),
                  charts_generated: chartsInStep,
                  total_charts_so_far: allCharts.length,
                };
              }

              functionResponseParts.push({
                functionResponse: {
                  name: toolName,
                  response: toolResultContent,
                },
              });
            } else {
              functionResponseParts.push({
                functionResponse: {
                  name: toolName,
                  response: {
                    status: 'error',
                    message: `Unknown tool: ${toolName}`,
                  },
                },
              });
            }
          } catch (toolErr: any) {
            console.error(`         ❌ Tool "${toolName}" failed:`, toolErr);
            functionResponseParts.push({
              functionResponse: {
                name: toolName,
                response: {
                  status: 'error',
                  message: toolErr?.message || String(toolErr),
                },
              },
            });
          }
        }

        // Send function responses back to model using proper format
        console.log(`      📤 Sending ${functionResponseParts.length} function response(s) to model`);
        await chat.sendMessage(functionResponseParts);

        // After tools, loop again
        continue;
      }

      // 2) No tool calls: model is trying to answer in natural language
      const contentText = response.text().trim();

      console.log('      🧠 Non-tool assistant content length:', contentText.length);

      // If we don't have enough charts yet, push follow-up and continue
      if (allCharts.length < MIN_CHARTS && round < MAX_ROUNDS - 1) {
        console.log(
          `      ⚠️ Assistant tried to finish early with ${allCharts.length} charts. Forcing it to continue and create more charts.`,
        );

        await chat.sendMessage(
          `You have not yet generated the required ${MIN_CHARTS} charts. ` +
            `Please continue the analysis:\n` +
            `- Use run_python to compute more metrics if needed\n` +
            `- Use run_python again to generate at least ${
              MIN_CHARTS - allCharts.length
            } additional visualizations with matplotlib and plt.show()\n` +
            `Remember to weave in the external context from the system messages where relevant.\n` +
            `Do not write a final report until all required charts are created.`,
        );

        continue;
      }

      // Else, accept as final summary
      finalSummary = contentText;
      console.log('   🧠 Final assistant message content length:', finalSummary.length);
      break;
    }

    let structuredReport = parseStructuredReport(finalSummary);

    if (structuredReport && structuredReport.summary) {
      finalSummary = structuredReport.summary;
    }

    if (!finalSummary || finalSummary.length < 50) {
      console.warn(
        '   ⚠️ Final summary was empty or too short. Using fallback.',
      );
      finalSummary =
        'The analysis completed, but the model returned a very short response. Please review the generated charts and logs for details.';
    }

    console.log(`   📊 Total Charts Captured: ${allCharts.length}`);

    const output: E2BAgentOutput = {
      summary: finalSummary,
      charts: allCharts,
      externalContext,
      structuredReport,
      insights: {
        steps: 'manual-chat-loop',
        analysis: finalSummary,
        totalCharts: allCharts.length,
        externalContextUsed: !!externalContext,
      },
    };

    return output;
  } catch (err: any) {
    console.error('\n   ❌ CRITICAL AGENT ERROR:', err);
    if (err?.message?.includes('timeout')) {
      throw new Error(
        'Connection to E2B Sandbox timed out. Please try again.',
      );
    }
    throw err;
  } finally {
    if (sandbox) {
      console.log('   🧹 Cleanup: Killing sandbox...');
      sandbox.kill().catch((e) => console.error('Cleanup warning:', e));
    }
  }
}
