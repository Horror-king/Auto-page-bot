const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// Create tokens.json if it doesn't exist
const tokensFile = path.join(__dirname, 'tokens.json');
if (!fs.existsSync(tokensFile)) {
  fs.writeFileSync(tokensFile, JSON.stringify([]));
}

app.use(express.static('public'));
app.use(bodyParser.json());

// Enhanced logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

let bots = [];

// Load existing bots from tokens.json
try {
  const data = fs.readFileSync(tokensFile, 'utf8');
  bots = JSON.parse(data);
  console.log(`Loaded ${bots.length} bots from tokens.json`);
} catch (err) {
  console.error('Error reading tokens.json:', err);
}

// TEMP: Hardcoded bot so Facebook can verify the webhook
const DEFAULT_VERIFY_TOKEN = "Hassan";
if (!bots.some(bot => bot.id === "default-bot")) {
  bots.push({
    id: "default-bot",
    verifyToken: DEFAULT_VERIFY_TOKEN,
    pageAccessToken: "DUMMY_TOKEN",
    geminiKey: "DUMMY_KEY"
  });
}

// Save bots to tokens.json
function saveBots() {
  fs.writeFile(tokensFile, JSON.stringify(bots, null, 2), (err) => {
    if (err) {
      console.error('Error saving bots:', err);
    } else {
      console.log('Bots saved to tokens.json');
    }
  });
}

// Endpoint to set up new bots
app.post('/set-tokens', (req, res) => {
  const { verifyToken, pageAccessToken, geminiKey, pageId } = req.body;
  
  // Check if bot with this pageId already exists
  const existingBotIndex = bots.findIndex(bot => bot.pageId === pageId);
  
  const bot = {
    id: `bot_${Date.now()}`,
    pageId,
    verifyToken,
    pageAccessToken,
    geminiKey,
    createdAt: new Date().toISOString()
  };

  if (existingBotIndex >= 0) {
    bots[existingBotIndex] = bot;
    console.log(`🔄 Bot ${bot.id} updated for page ${pageId}`);
  } else {
    bots.push(bot);
    console.log(`✅ Bot ${bot.id} registered for page ${pageId}`);
  }

  saveBots();
  res.send("✅ Bot configuration saved successfully!");
});

// Webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`Webhook verification attempt with token: ${token}`);
  
  const bot = bots.find(b => b.verifyToken === token);
  if (mode === 'subscribe' && bot) {
    console.log(`✅ Webhook verified for bot ${bot.id}`);
    res.status(200).send(challenge);
  } else {
    console.warn(`❌ Webhook verification failed. Token: ${token}, Mode: ${mode}`);
    res.sendStatus(403);
  }
});

// Handle messages
app.post('/webhook', async (req, res) => {
  console.log('Received webhook event:', JSON.stringify(req.body, null, 2));
  
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;
      const pageId = entry.id;  

      console.log(`Processing message from sender ${senderId} on page ${pageId}`);
      
      const bot = bots.find(b => b.pageAccessToken !== "DUMMY_TOKEN" && b.pageId === pageId);  

      if (!bot) {  
        console.warn(`❌ No bot found for page ID: ${pageId}`);  
        return res.sendStatus(404);  
      }  

      if (webhookEvent.message?.text) {  
        console.log(`Received message: "${webhookEvent.message.text}"`);
        try {
          const reply = await generateGeminiReply(webhookEvent.message.text, bot.geminiKey);  
          console.log(`Sending reply: "${reply}"`);
          await sendMessage(senderId, reply, bot.pageAccessToken);  
        } catch (error) {
          console.error('Error processing message:', error);
        }
      }  
    }  
    res.status(200).send('EVENT_RECEIVED');
  } else {
    console.warn('Received unknown webhook object type:', body.object);
    res.sendStatus(404);
  }
});

// Generate Gemini AI reply
async function generateGeminiReply(userText, geminiKey) {
  try {
    console.log('Generating Gemini reply...');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(`Your name is KORA AI. Reply with soft vibes:\n\nUser: ${userText}`);
    const response = await result.response.text();
    console.log('Gemini response generated successfully');
    return response;
  } catch (e) {
    console.error("Gemini error:", e);
    return "KORA AI is taking a break. Please try again later.";
  }
}

// Send reply to Messenger
function sendMessage(recipientId, text, accessToken) {
  return new Promise((resolve, reject) => {
    const body = {
      recipient: { id: recipientId },
      message: { text }
    };

    const request = https.request({
      hostname: 'graph.facebook.com',
      path: `/v12.0/me/messages?access_token=${accessToken}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    request.on('response', (res) => {
      console.log(`Facebook API response: ${res.statusCode}`);
      resolve();
    });

    request.on('error', err => {
      console.error("Send error:", err);
      reject(err);
    });
    
    request.write(JSON.stringify(body));
    request.end();
  });
}

// Endpoint to list all bots (for debugging)
app.get('/bots', (req, res) => {
  res.json(bots);
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
  console.log('Current bot configurations:', bots);
});
