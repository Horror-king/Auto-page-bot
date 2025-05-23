const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(bodyParser.json());

let bots = [];
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

// Load existing tokens
if (fs.existsSync(TOKENS_FILE)) {
  try {
    bots = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  } catch (err) {
    console.error("Failed to parse tokens.json", err);
  }
}

// ======================= ADMIN LOGIN =========================
app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ======================= SET TOKENS =========================
app.post('/set-tokens', (req, res) => {
  const { verifyToken, pageAccessToken, geminiKey } = req.body;
  const bot = {
    id: `bot_${Date.now()}`,
    verifyToken,
    pageAccessToken,
    geminiKey
  };
  bots.push(bot);
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(bots, null, 2));
  res.send("✅ Bot registered");
});

// ======================= VERIFY WEBHOOK =========================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const bot = bots.find(b => b.verifyToken === token);
  if (mode === 'subscribe' && bot) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ======================= HANDLE MESSAGES =========================
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      const senderId = event.sender.id;
      const pageId = entry.id;

      const bot = bots.find(b => b.pageAccessToken && pageId);
      if (!bot) continue;

      if (event.message?.text) {
        const reply = await generateGeminiReply(event.message.text, bot.geminiKey);
        sendMessage(senderId, reply, bot.pageAccessToken);
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

async function generateGeminiReply(text, key) {
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(`You are KORA AI. Reply gently:\n\nUser: ${text}`);
    return result.response.text();
  } catch (e) {
    return "KORA AI is resting. Please try again later.";
  }
}

function sendMessage(recipientId, text, accessToken) {
  const body = {
    recipient: { id: recipientId },
    message: { text }
  };

  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/v12.0/me/messages?access_token=${accessToken}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  req.on('error', e => console.error("Send error:", e));
  req.write(JSON.stringify(body));
  req.end();
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
