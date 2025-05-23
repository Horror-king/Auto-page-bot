const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.static('public'));
app.use(bodyParser.json());

const TOKENS_FILE = path.join(__dirname, 'tokens.json');

// Load bots from tokens.json
let bots = [];
if (fs.existsSync(TOKENS_FILE)) {
  try {
    bots = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    console.log(`✅ Loaded ${bots.length} bots from tokens.json`);
  } catch (err) {
    console.error("❌ Error reading tokens.json:", err);
  }
} else {
  bots.push({
    id: "default-bot",
    pageId: "default",
    verifyToken: "Hassan",
    pageAccessToken: "DUMMY_TOKEN",
    geminiKey: "DUMMY_KEY"
  });
  console.warn("⚠️ No tokens.json found. Default bot loaded.");
}

// Save new bot to tokens.json
function saveBots() {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(bots, null, 2));
  console.log("✅ tokens.json updated.");
}

// ================== Register New Bot ==================
app.post('/set-tokens', (req, res) => {
  const { pageId, verifyToken, pageAccessToken, geminiKey } = req.body;
  if (!pageId || !verifyToken || !pageAccessToken || !geminiKey) {
    return res.status(400).send("Missing fields");
  }

  const bot = {
    id: `bot_${Date.now()}`,
    pageId,
    verifyToken,
    pageAccessToken,
    geminiKey
  };

  bots.push(bot);
  saveBots();
  console.log(`✅ Bot ${bot.id} registered for Page ID ${pageId}`);
  res.send("✅ Bot added. Webhook ready!");
});

// ============ Webhook Verification ============
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const bot = bots.find(b => b.verifyToken === token);
  if (mode === 'subscribe' && bot) {
    console.log("✅ Webhook verified");
    res.status(200).send(challenge);
  } else {
    console.warn("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

// ============ Webhook Events ============
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;
      const pageId = entry.id;

      const bot = bots.find(b => b.pageId === pageId);
      if (!bot) {
        console.warn("❌ No bot found for Page ID:", pageId);
        continue;
      }

      if (webhookEvent.message?.text) {
        const reply = await generateGeminiReply(webhookEvent.message.text, bot.geminiKey);
        sendMessage(senderId, reply, bot.pageAccessToken);
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// ============ Gemini AI Integration ============
async function generateGeminiReply(userText, geminiKey) {
  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(`Your name is KORA AI. Reply with soft vibes:\n\nUser: ${userText}`);
    return result.response.text();
  } catch (e) {
    console.error("❌ Gemini error:", e);
    return "KORA AI is taking a break. Please try again later.";
  }
}

// ============ Send Message to Messenger ============
function sendMessage(recipientId, text, accessToken) {
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

  request.on('error', err => console.error("Send error:", err));
  request.write(JSON.stringify(body));
  request.end();
}

// ============ Start Server ============
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
