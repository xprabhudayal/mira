// Test script to debug the webhook locally
// Run with: npx ts-node test-webhook.ts

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local explicitly
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Test 1: Check environment variables
console.log('\n=== ENVIRONMENT CHECK ===');
console.log('WHATSAPP_PHONE_NUMBER_ID:', process.env.WHATSAPP_PHONE_NUMBER_ID ? '✅ Set' : '❌ Missing');
console.log('WHATSAPP_ACCESS_TOKEN:', process.env.WHATSAPP_ACCESS_TOKEN ? `✅ Set (${process.env.WHATSAPP_ACCESS_TOKEN?.substring(0, 20)}...)` : '❌ Missing');
console.log('E2B_API_KEY:', process.env.E2B_API_KEY ? '✅ Set' : '❌ Missing');
console.log('GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Missing');
console.log('BLOB_READ_WRITE_TOKEN:', process.env.BLOB_READ_WRITE_TOKEN ? '✅ Set' : '❌ Missing');

// Test 2: Test WhatsApp API directly
async function testWhatsAppAPI() {
  console.log('\n=== WHATSAPP API TEST ===');
  
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.log('❌ Cannot test - missing credentials');
    return;
  }
  
  // Test sending a message to yourself (replace with your number)
  const testPhone = process.argv[2]; // Pass phone number as argument
  
  if (!testPhone) {
    console.log('⚠️ No test phone number provided. Usage: npx ts-node test-webhook.ts +1234567890');
    console.log('   Skipping send test, but testing API connection...');
  }
  
  // Test API connection by getting phone number info
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
    });
    
    const data = await response.text();
    
    if (response.ok) {
      console.log('✅ WhatsApp API connection successful!');
      console.log('   Response:', data);
    } else {
      console.log('❌ WhatsApp API error:', response.status);
      console.log('   Response:', data);
    }
  } catch (error) {
    console.log('❌ WhatsApp API connection failed:', error);
  }
  
  // If phone number provided, try sending a test message
  if (testPhone) {
    console.log(`\n📤 Sending test message to ${testPhone}...`);
    
    const sendUrl = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: testPhone.replace(/\D/g, ''),
      type: 'text',
      text: {
        preview_url: false,
        body: '🧪 Test message from Mira debug script!',
      },
    };
    
    try {
      const response = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      
      const data = await response.text();
      
      if (response.ok) {
        console.log('✅ Message sent successfully!');
        console.log('   Response:', data);
      } else {
        console.log('❌ Failed to send message:', response.status);
        console.log('   Response:', data);
      }
    } catch (error) {
      console.log('❌ Send message failed:', error);
    }
  }
}

// Test 3: Test Gemini API
async function testGeminiAPI() {
  console.log('\n=== GEMINI API TEST ===');
  
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  
  if (!GOOGLE_API_KEY) {
    console.log('❌ Cannot test - GOOGLE_API_KEY missing');
    return;
  }
  
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    console.log('📤 Testing Gemini API with simple prompt...');
    const result = await model.generateContent('Say "Hello, Mira is working!" in exactly those words.');
    const response = result.response;
    const text = response.text();
    
    console.log('✅ Gemini API working!');
    console.log('   Response:', text.substring(0, 100));
  } catch (error: any) {
    console.log('❌ Gemini API error:', error.message);
    if (error.message.includes('not found')) {
      console.log('   💡 Try using a different model name like "gemini-1.5-flash" or "gemini-pro"');
    }
  }
}

// Test 4: Test E2B API
async function testE2BAPI() {
  console.log('\n=== E2B API TEST ===');
  
  const E2B_API_KEY = process.env.E2B_API_KEY;
  
  if (!E2B_API_KEY) {
    console.log('❌ Cannot test - E2B_API_KEY missing');
    return;
  }
  
  try {
    const { Sandbox } = await import('@e2b/code-interpreter');
    
    console.log('📤 Creating E2B sandbox...');
    const sandbox = await Sandbox.create({
      apiKey: E2B_API_KEY,
      timeoutMs: 60000,
    });
    
    console.log('✅ Sandbox created:', sandbox.sandboxId);
    
    console.log('📤 Running test Python code...');
    const exec = await sandbox.runCode('print("Hello from E2B!")');
    
    if (exec.error) {
      console.log('❌ Python execution error:', exec.error);
    } else {
      console.log('✅ Python execution successful!');
      console.log('   Output:', exec.logs?.stdout?.join(''));
    }
    
    await sandbox.kill();
    console.log('✅ Sandbox cleaned up');
  } catch (error: any) {
    console.log('❌ E2B API error:', error.message);
  }
}

// Run all tests
async function main() {
  await testWhatsAppAPI();
  await testGeminiAPI();
  await testE2BAPI();
  
  console.log('\n=== DONE ===\n');
}

main().catch(console.error);
