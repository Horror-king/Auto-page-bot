const express = require('express');
const fs = require('fs');
const https = require('https');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

const TOKENS_FILE = './tokens.json';
let botTokens = {};

// Load existing tokens on startup
if (fs.existsSync(TOKENS_FILE)) {
  botTokens = JSON.parse(fs.readFileSync(TOKENS_FILE));
}

app.use(express.static('public'));
app.use(bodyParser.json());

app.post('/set-tokens', (req, res) => {
  const { pageId, verifyToken, pageAccessToken, geminiKey } = req.body;

  botTokens[pageId] = { verifyToken, pageAccessToken, geminiKey };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(botTokens, null, 2));

  res.send("✅ Bot tokens saved successfully!");
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const matchedPageId = Object.keys(botTokens).find(pageId =>
    botTokens[pageId].verifyToken === token
  );

  if (mode === 'subscribe' && matchedPageId) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const pageId = entry.id;
      const tokens = botTokens[pageId];
      if (!tokens) continue;

      for (const event of entry.messaging) {
        const senderId = event.sender.id;
        if (event.message?.text) {
          const reply = await generateGeminiReply(tokens.geminiKey, event.message.text);
          sendMessage(tokens.pageAccessToken, senderId, reply);
        }
      }
    }

    return res.status(200).send('EVENT_RECEIVED');
  } else {
    return res.sendStatus(404);
  }
});

async function generateGeminiReply(apiKey, userText) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(`Your name is KORA AI. Reply with soft vibes:\n\nUser: ${userText}`);
    return result.response.text();
  } catch (e) {
    console.error("Gemini Error:", e);
    return "Oops... KORA AI is currently unavailable.";
  }
}

function sendMessage(token, recipientId, text) {
  const body = {
    recipient: { id: recipientId },
    message: { text }
  };

  const request = https.request({
    hostname: 'graph.facebook.com',
    path: `/v12.0/me/messages?access_token=${token}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  request.on('error', err => console.error("Send Error:", err));
  request.write(JSON.stringify(body));
  request.end();
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});