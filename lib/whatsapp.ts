// Meta WhatsApp Cloud API Integration

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

// Helper to get credentials at runtime (important for serverless)
function getCredentials() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!phoneNumberId || !accessToken) {
    console.error('⚠️ WhatsApp credentials not configured. PHONE_NUMBER_ID:', !!phoneNumberId, 'ACCESS_TOKEN:', !!accessToken);
  }
  
  return { phoneNumberId, accessToken };
}

/**
 * Send a text message via WhatsApp Cloud API
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string,
  mediaUrl?: string
): Promise<void> {
  const { phoneNumberId, accessToken } = getCredentials();
  
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp not configured - missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN');
  }

  // Remove any non-numeric characters from phone number
  const cleanPhone = to.replace(/\D/g, '');

  const url = `${WHATSAPP_API_URL}/${phoneNumberId}/messages`;

  let body: any;

  if (mediaUrl) {
    // Send document with caption
    body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'document',
      document: {
        link: mediaUrl,
        caption: message,
        filename: 'report.pdf',
      },
    };
  } else {
    // Send text message
    body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: message,
      },
    };
  }

  console.log(`📤 Sending WhatsApp message to ${cleanPhone}, type: ${mediaUrl ? 'document' : 'text'}`);
  console.log(`   Using PHONE_NUMBER_ID: ${phoneNumberId?.substring(0, 6)}...`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  
  if (!response.ok) {
    console.error('❌ WhatsApp API Error:', response.status, responseText);
    throw new Error(`Failed to send WhatsApp message: ${response.status} - ${responseText}`);
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = responseText;
  }
  console.log('✅ Message sent successfully:', JSON.stringify(result));
}

/**
 * Download media from WhatsApp Cloud API
 */
export async function downloadMedia(mediaId: string): Promise<Buffer> {
  const { accessToken } = getCredentials();
  
  if (!accessToken) {
    throw new Error('WhatsApp not configured - missing WHATSAPP_ACCESS_TOKEN');
  }

  // Step 1: Get media URL
  const mediaInfoUrl = `${WHATSAPP_API_URL}/${mediaId}`;
  const mediaInfoResponse = await fetch(mediaInfoUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!mediaInfoResponse.ok) {
    throw new Error(`Failed to get media info: ${mediaInfoResponse.statusText}`);
  }

  const mediaInfo = await mediaInfoResponse.json() as { url: string };
  const mediaUrl = mediaInfo.url;

  // Step 2: Download media file
  const mediaResponse = await fetch(mediaUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!mediaResponse.ok) {
    throw new Error(`Failed to download media: ${mediaResponse.statusText}`);
  }

  return Buffer.from(await mediaResponse.arrayBuffer());
}

/**
 * Extract phone number from WhatsApp webhook payload
 */
export function extractPhoneNumber(phone: string): string {
  // Remove any non-numeric characters
  return phone.replace(/\D/g, '');
}

/**
 * Mark message as read
 */
export async function markMessageAsRead(messageId: string): Promise<void> {
  const { phoneNumberId, accessToken } = getCredentials();
  
  if (!phoneNumberId || !accessToken) {
    console.warn('Cannot mark message as read - WhatsApp not configured');
    return;
  }

  const url = `${WHATSAPP_API_URL}/${phoneNumberId}/messages`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch (err) {
    console.warn('Failed to mark message as read:', err);
  }
}
