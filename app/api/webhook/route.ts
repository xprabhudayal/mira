import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sendWhatsAppMessage, downloadMedia, markMessageAsRead } from '../../../lib/whatsapp';
import { getSession, createSession, updateSession } from '../../../lib/session-store';
import { runE2BAgent } from '../../../lib/e2b-agent';
import { generatePDF } from '../../../lib/pdf-generator';
import { WhatsAppWebhookPayload } from '../../../lib/types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET handler for webhook verification (Meta requirement)
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'hello-mira';

  console.log('🔍 Verification attempt:', { mode, token, challenge, expected: VERIFY_TOKEN });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    return new NextResponse(challenge, { status: 200 });
  } else {
    console.error('❌ Webhook verification failed', { 
      receivedToken: token, 
      expectedToken: VERIFY_TOKEN,
      mode 
    });
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
  }
}

/**
 * POST handler for incoming WhatsApp messages
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json() as WhatsAppWebhookPayload;

    console.log('📱 Received webhook:', JSON.stringify(payload, null, 2));

    // Validate webhook payload
    if (payload.object !== 'whatsapp_business_account') {
      console.log('⚠️ Invalid webhook object:', payload.object);
      return NextResponse.json({ error: 'Invalid webhook object' }, { status: 400 });
    }

    // Process each entry - handle messages asynchronously to respond quickly to Meta
    const messagePromises: Promise<void>[] = [];
    
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') {
          console.log('⚠️ Skipping non-messages field:', change.field);
          continue;
        }

        const value = change.value;

        // Handle status updates (delivered, read, etc.)
        if (value.statuses) {
          console.log('📊 Status update:', JSON.stringify(value.statuses));
          continue;
        }

        // Handle incoming messages
        if (value.messages && value.messages.length > 0) {
          console.log(`📨 Processing ${value.messages.length} message(s)`);
          for (const message of value.messages) {
            // Process each message - don't await to respond quickly
            messagePromises.push(
              handleIncomingMessage(message, value.metadata.phone_number_id)
                .catch(err => console.error('❌ Error handling message:', err))
            );
          }
        } else {
          console.log('⚠️ No messages in webhook payload');
        }
      }
    }

    // Wait for all message processing to complete (with timeout protection)
    if (messagePromises.length > 0) {
      await Promise.all(messagePromises);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Simple in-memory deduplication (for production, use Redis/KV)
const processedMessages = new Set<string>();
const MESSAGE_DEDUP_TTL = 60000; // 1 minute

function isMessageProcessed(messageId: string): boolean {
  if (processedMessages.has(messageId)) {
    return true;
  }
  processedMessages.add(messageId);
  // Clean up after TTL
  setTimeout(() => processedMessages.delete(messageId), MESSAGE_DEDUP_TTL);
  return false;
}

/**
 * Handle individual incoming message
 */
async function handleIncomingMessage(message: any, _phoneNumberId: string) {
  const from = message.from;
  const messageId = message.id;
  const messageType = message.type;

  console.log(`📱 Processing message from ${from}, type: ${messageType}, id: ${messageId}`);

  // Deduplicate messages (WhatsApp can send duplicates)
  if (isMessageProcessed(messageId)) {
    console.log(`⚠️ Skipping duplicate message: ${messageId}`);
    return;
  }

  // Mark message as read
  await markMessageAsRead(messageId).catch(err => 
    console.warn('Failed to mark message as read:', err)
  );

  // Get or create user session
  let session = getSession(from);
  if (!session) {
    session = createSession(from);
    console.log(`🆕 Created new session for ${from}`);
  } else {
    console.log(`📋 Found existing session for ${from}, has CSV: ${!!session.csvBuffer}`);
  }

  let csvBuffer: Buffer | undefined;
  let userMessage = '';

  // Handle different message types
  if (messageType === 'text' && message.text) {
    userMessage = message.text.body;
  } else if (messageType === 'document' && message.document) {
    // Check if it's a CSV file
    const mimeType = message.document.mime_type || '';
    const filename = message.document.filename || '';
    
    if (mimeType.includes('csv') || filename.endsWith('.csv')) {
      console.log('📥 Downloading CSV file...');
      try {
        csvBuffer = await downloadMedia(message.document.id!);
        
        // Update session with CSV
        updateSession(from, {
          csvBuffer,
          conversationHistory: [
            ...session.conversationHistory,
            { role: 'user', content: 'Uploaded CSV file' }
          ]
        });

        userMessage = message.document.caption || 'Analyze this data and provide comprehensive insights';
        
        // Send acknowledgment
        await sendWhatsAppMessage(
          from,
          '🤖 Received your CSV! Analyzing data...\n\nThis will take 3-5 minutes. I\'m:\n• Setting up secure analysis environment\n• Converting to database\n• Running SQL queries\n• Detecting trends\n• Searching the web for context\n• Generating your report\n\nI\'ll send you the PDF when ready! ⏳'
        );
        
        // Process asynchronously
        processCSVAsync(from, csvBuffer, userMessage, session.conversationHistory).catch(error => {
          console.error('Background processing error:', error);
        });
        
        return;
        
      } catch (error) {
        console.error('Error downloading CSV:', error);
        await sendWhatsAppMessage(from, '❌ Sorry, I couldn\'t download the CSV file. Please try again.');
        return;
      }
    } else {
      await sendWhatsAppMessage(from, '❌ Please send a CSV file. Other document types are not supported.');
      return;
    }
  } else if (messageType === 'image' || messageType === 'audio' || messageType === 'video') {
    await sendWhatsAppMessage(from, '❌ Please send a CSV file for analysis. Media files are not supported.');
    return;
  }

  // Handle text messages
  if (userMessage && !csvBuffer) {
    if (!session.csvBuffer) {
      // No CSV in session - send welcome message
      console.log(`📤 Sending welcome message to ${from}`);
      try {
        await sendWhatsAppMessage(
          from,
          '👋 Welcome to *Mira* - Your AI Data Analyst!\n\nPlease send me a CSV file to analyze. I can:\n\n📊 Analyze trends and patterns\n📈 Perform statistical analysis\n🌐 Research external context\n📄 Generate beautiful PDF reports\n\nJust send your CSV to get started!'
        );
        console.log(`✅ Welcome message sent successfully to ${from}`);
      } catch (sendError) {
        console.error(`❌ Failed to send welcome message to ${from}:`, sendError);
      }
      return;
    } else {
      // User sent a follow-up message
      csvBuffer = session.csvBuffer;
      
      updateSession(from, {
        conversationHistory: [
          ...session.conversationHistory,
          { role: 'user', content: userMessage }
        ]
      });

      await sendWhatsAppMessage(
        from,
        '🤖 Analyzing your request...\n\nProcessing with context from your previous CSV. This will take a few minutes...'
      );
      
      // Process asynchronously
      processCSVAsync(from, csvBuffer, userMessage, session.conversationHistory).catch(error => {
        console.error('Background processing error:', error);
      });
      
      return;
    }
  }
}

/**
 * Async processing function that continues after HTTP response
 */
async function processCSVAsync(
  from: string, 
  csvBuffer: Buffer, 
  userMessage: string, 
  conversationHistory: any[]
) {
  try {
    console.log('🚀 Starting E2B agent (background)...');
    const result = await runE2BAgent({
      csvBuffer,
      userMessage,
      conversationHistory
    });

    console.log(`📊 Analysis complete: ${result.charts.length} charts generated`);

    // Generate PDF on Vercel with Puppeteer
    console.log('📄 Generating PDF report...');
    const pdfBuffer = await generatePDF({
      summary: result.summary,
      charts: result.charts,
      externalContext: result.externalContext,
      structuredReport: result.structuredReport
    });

    // Upload PDF to Vercel Blob
    console.log('☁️ Uploading PDF to cloud storage...');
    const blob = await put(`reports/${from}-${Date.now()}.pdf`, pdfBuffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    // Update session with results
    updateSession(from, {
      analysisResults: result.insights,
      conversationHistory: [
        ...conversationHistory,
        { role: 'assistant', content: result.summary }
      ]
    });

    // Send PDF link to user
    const summaryPreview = result.summary.substring(0, 200);
    const responseMessage = `✅ *Analysis Complete!*\n\n${summaryPreview}${result.summary.length > 200 ? '...' : ''}\n\n📊 Your detailed PDF report is ready 👇`;
    
    await sendWhatsAppMessage(from, responseMessage, blob.url);

    console.log('✨ Successfully sent report to user');
  } catch (error) {
    console.error('❌ Background processing error:', error);
    
    try {
      await sendWhatsAppMessage(
        from,
        '❌ Sorry, something went wrong while analyzing your data. Please try again. If the issue persists, check if your CSV format is correct.'
      );
    } catch (notifyError) {
      console.error('Failed to notify user of background error:', notifyError);
    }
  }
}
