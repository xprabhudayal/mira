// Direct test of E2B agent with CSV
// Run with: npx ts-node --esm test-e2b-agent.ts

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Sample iris dataset CSV
const IRIS_CSV = `sepal_length,sepal_width,petal_length,petal_width,species
5.1,3.5,1.4,0.2,setosa
4.9,3.0,1.4,0.2,setosa
4.7,3.2,1.3,0.2,setosa
4.6,3.1,1.5,0.2,setosa
5.0,3.6,1.4,0.2,setosa
5.4,3.9,1.7,0.4,setosa
4.6,3.4,1.4,0.3,setosa
5.0,3.4,1.5,0.2,setosa
7.0,3.2,4.7,1.4,versicolor
6.4,3.2,4.5,1.5,versicolor
6.9,3.1,4.9,1.5,versicolor
5.5,2.3,4.0,1.3,versicolor
6.5,2.8,4.6,1.5,versicolor
5.7,2.8,4.5,1.3,versicolor
6.3,3.3,6.0,2.5,virginica
5.8,2.7,5.1,1.9,virginica
7.1,3.0,5.9,2.1,virginica
6.3,2.9,5.6,1.8,virginica
6.5,3.0,5.8,2.2,virginica
7.6,3.0,6.6,2.1,virginica
4.9,2.5,4.5,1.7,virginica
7.3,2.9,6.3,1.8,virginica
6.7,2.5,5.8,1.8,virginica
7.2,3.6,6.1,2.5,virginica`;

async function main() {
  console.log('=== E2B AGENT DIRECT TEST ===\n');
  
  console.log('Environment check:');
  console.log('  E2B_API_KEY:', process.env.E2B_API_KEY ? '✅' : '❌');
  console.log('  GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅' : '❌');
  console.log('  GEMINI_MODEL:', process.env.GEMINI_MODEL || 'gemini-2.0-flash (default)');
  console.log('');
  
  const { runE2BAgent } = await import('./lib/e2b-agent.js');
  
  const csvBuffer = Buffer.from(IRIS_CSV, 'utf-8');
  
  console.log('📊 Testing with Iris dataset CSV...');
  console.log(`   CSV size: ${csvBuffer.length} bytes`);
  console.log('');
  
  try {
    const result = await runE2BAgent({
      csvBuffer,
      userMessage: 'Analyze this iris dataset. Show me the distribution of species and key statistics.',
      conversationHistory: []
    });
    
    console.log('\n=== RESULT ===');
    console.log('Summary length:', result.summary.length);
    console.log('Charts generated:', result.charts.length);
    console.log('External context:', result.externalContext ? 'Yes' : 'No');
    console.log('Structured report:', result.structuredReport ? 'Yes' : 'No');
    
    if (result.summary) {
      console.log('\n--- Summary Preview ---');
      console.log(result.summary.substring(0, 500) + '...');
    }
    
    if (result.structuredReport) {
      console.log('\n--- Structured Report ---');
      console.log('KPIs:', result.structuredReport.kpis?.length || 0);
      console.log('Charts:', result.structuredReport.charts?.length || 0);
    }
    
    console.log('\n✅ E2B Agent test completed successfully!');
    
  } catch (error: any) {
    console.error('\n❌ E2B Agent test failed:', error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);
