// Direct test of E2B agent - bypasses module resolution issues
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { Sandbox } from '@e2b/code-interpreter';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

async function main() {
  console.log('=== DIRECT E2B + GEMINI TEST ===\n');
  
  // Read the actual CSV file
  const csvPath = './iris-dataset.csv';
  const csvBuffer = fs.readFileSync(csvPath);
  console.log(`📊 Loaded CSV: ${csvBuffer.length} bytes`);
  
  // Check env
  if (!process.env.E2B_API_KEY) throw new Error('E2B_API_KEY missing');
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY missing');
  
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  console.log(`🤖 Using model: ${modelName}`);
  
  // Create sandbox
  console.log('\n📦 Creating E2B sandbox...');
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY!,
    timeoutMs: 300_000,
  });
  console.log(`✅ Sandbox ready: ${sandbox.sandboxId}`);
  
  // Upload CSV
  const sandboxCsvPath = '/home/user/data.csv';
  console.log('\n📤 Uploading CSV to sandbox...');
  await sandbox.files.write(sandboxCsvPath, csvBuffer);
  console.log('✅ CSV uploaded');
  
  // Setup Gemini
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  
  const tools = [{
    functionDeclarations: [{
      name: 'run_python',
      description: `Run Python code. CSV is at '${sandboxCsvPath}'.`,
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          code: { type: SchemaType.STRING, description: 'Python code' },
          reasoning: { type: SchemaType.STRING, description: 'What this does' },
        },
        required: ['code', 'reasoning'],
      },
    }],
  }];
  
  const model = genAI.getGenerativeModel({ model: modelName, tools });
  const chat = model.startChat({ history: [] });
  
  const prompt = `You are a data analyst with access to a Python sandbox. The CSV file is at '${sandboxCsvPath}'.

YOUR TASK:
1. First, call run_python to load and explore the CSV with pandas
2. Then, call run_python AGAIN to create a histogram chart with matplotlib (MUST call plt.show())
3. Then, call run_python AGAIN to create a bar chart with matplotlib (MUST call plt.show())

IMPORTANT: You MUST use the run_python tool to execute code. Do NOT just describe what you would do - actually call the tool.

Start NOW by calling run_python with this code:
import pandas as pd
df = pd.read_csv('${sandboxCsvPath}')
print(df.head())
print(df.describe())`;

  console.log('\n🚀 Starting analysis...\n');
  
  const allCharts: Buffer[] = [];
  let finalText = '';
  
  for (let round = 0; round < 8; round++) {
    console.log(`--- Round ${round + 1} ---`);
    
    const result = await chat.sendMessage(round === 0 ? prompt : '');
    const response = result.response;
    
    const functionCalls = response.functionCalls();
    
    if (functionCalls && functionCalls.length > 0) {
      console.log(`🔧 ${functionCalls.length} function call(s)`);
      
      const functionResponseParts: any[] = [];
      
      for (const fc of functionCalls) {
        const args = fc.args as Record<string, unknown>;
        const code = args.code as string;
        const reasoning = (args.reasoning as string) || '';
        
        console.log(`   📝 ${reasoning.slice(0, 80)}...`);
        
        const exec = await sandbox.runCode(code);
        
        let chartsInStep = 0;
        if (exec.results) {
          for (const res of exec.results) {
            if (res.png) {
              allCharts.push(Buffer.from(res.png, 'base64'));
              chartsInStep++;
            }
          }
        }
        
        if (exec.error) {
          console.log(`   ❌ Error: ${exec.error.value}`);
          functionResponseParts.push({
            functionResponse: {
              name: fc.name,
              response: { status: 'error', error: exec.error.value },
            },
          });
        } else {
          const stdout = (exec.logs?.stdout || []).join('\n');
          console.log(`   ✅ Success, charts: ${chartsInStep}, stdout: ${stdout.length} chars`);
          functionResponseParts.push({
            functionResponse: {
              name: fc.name,
              response: { 
                status: 'success', 
                stdout: stdout.slice(0, 1500),
                charts_generated: chartsInStep,
                total_charts: allCharts.length,
              },
            },
          });
        }
      }
      
      await chat.sendMessage(functionResponseParts);
      continue;
    }
    
    // No function calls - model is responding with text
    finalText = response.text();
    console.log(`📝 Text response: ${finalText.length} chars`);
    
    if (allCharts.length >= 2) {
      console.log('\n✅ Got enough charts, stopping.');
      break;
    }
    
    // Push model to continue - be very explicit
    await chat.sendMessage(`You have ${allCharts.length} charts so far. You need at least 2.

Call run_python NOW with matplotlib code to create a chart. Example:
import matplotlib.pyplot as plt
import pandas as pd
df = pd.read_csv('${sandboxCsvPath}')
df['variety'].value_counts().plot(kind='bar')
plt.title('Species Distribution')
plt.show()`);
  }
  
  // Cleanup
  await sandbox.kill();
  
  console.log('\n=== RESULTS ===');
  console.log(`Charts generated: ${allCharts.length}`);
  console.log(`Final text length: ${finalText.length}`);
  
  if (allCharts.length > 0) {
    // Save charts
    for (let i = 0; i < allCharts.length; i++) {
      const chartPath = `./test-chart-${i + 1}.png`;
      fs.writeFileSync(chartPath, allCharts[i]);
      console.log(`💾 Saved: ${chartPath}`);
    }
  }
  
  if (finalText) {
    console.log('\n--- Summary ---');
    console.log(finalText.slice(0, 800));
  }
  
  console.log('\n✅ Test complete!');
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
