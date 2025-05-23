const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(bodyParser.json());

let bots = [];

// Default fallback bot for Facebook webhook verification
const DEFAULT_VERIFY_TOKEN = "Hassan";
bots.push({
  id: "default-bot",
  verifyToken: DEFAULT_VERIFY_TOKEN,
  pageAccessToken: "DUMMY_TOKEN",
  geminiKey: "DUMMY_KEY"
});

// ======================= ADMIN LOGIN =========================
app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;

  if (username === 'admin' && password === 'admin123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ======================= REGISTER NEW BOT =========================
app.post('/set-tokens', (req, res) => {
  const { verifyToken, pageAccessToken, geminiKey } = req.body;
  const bot = {
    id: `bot_${Date.now()}`,
    verifyToken,
    pageAccessToken,
    geminiKey
  };
  bots.push(bot);
  console.log(`✅ Bot ${bot.id} registered`);
  res.send("✅ Bot added. Webhook ready!");
});

// ======================= WEBHOOK VERIFY =========================
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

// ======================= WEBHOOK EVENTS =========================
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;
      const pageId = entry.id;

      const bot = bots.find(b => b.pageAccessToken !== "DUMMY_TOKEN" && pageId === pageId);
      if (!bot) {
        console.warn("❌ No bot found for page ID:", pageId);
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

// ======================= GEMINI AI =========================
async function generateGeminiReply(userText, geminiKey) {
  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(`Your name is KORA AI. Reply with soft vibes:\n\nUser: ${userText}`);
    return result.response.text();
  } catch (e) {
    console.error("Gemini error:", e);
    return "KORA AI is taking a break. Please try again later.";
  }
}

// ======================= SEND MESSAGE TO MESSENGER =========================
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

// ======================= START SERVER =========================
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
