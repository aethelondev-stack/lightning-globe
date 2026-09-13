const { WebSocketServer, WebSocket } = require('ws');
const { LiveChat } = require('youtube-chat');

const LIVE_ID = process.env.YOUTUBE_LIVE_ID || process.argv[2] || 'mLkBRGzbkE4';
const INTERNAL_PORT = parseInt(process.env.STREAM_WS_PORT || '3001', 10);

// Global anti-spam cooldown (ms)
const GLOBAL_COOLDOWN_MS = 2500;
let lastCommandTimestamp = 0;
const userCooldowns = new Map();

// 1. Start Internal WebSocket Server for Globe Browser Client
const wss = new WebSocketServer({ port: INTERNAL_PORT }, () => {
  console.log(`[YouTubeChatBridge] Internal WebSocket server listening on ws://127.0.0.1:${INTERNAL_PORT}`);
});

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[YouTubeChatBridge] Frontend client connected (Total: ${clients.size})`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[YouTubeChatBridge] Frontend client disconnected (Remaining: ${clients.size})`);
  });
});

function broadcastCommand(cmd, username) {
  const payload = JSON.stringify({
    type: 'COMMAND',
    command: cmd,
    user: username,
    timestamp: Date.now()
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// 2. Connect to YouTube Live Chat
function startYouTubeChat() {
  console.log(`[YouTubeChatBridge] Connecting to YouTube Live Chat for Video: ${LIVE_ID}...`);
  const liveChat = new LiveChat({ liveId: LIVE_ID });

  liveChat.on('start', (initialLiveId) => {
    console.log(`[YouTubeChatBridge] Live Chat successfully active for ${initialLiveId}!`);
  });

  liveChat.on('chat', (chatItem) => {
    const author = chatItem.author.name;
    const rawMsg = chatItem.message.map((m) => m.text || '').join('').trim();

    if (!rawMsg.startsWith('!')) return;

    const now = Date.now();
    // Global rate limit
    if (now - lastCommandTimestamp < GLOBAL_COOLDOWN_MS) {
      console.log(`[YouTubeChatBridge] Cooldown active, skipped: ${rawMsg}`);
      return;
    }

    // User rate limit (10s per user)
    const userLast = userCooldowns.get(author) || 0;
    if (now - userLast < 10000) {
      console.log(`[YouTubeChatBridge] User cooldown active for ${author}`);
      return;
    }

    lastCommandTimestamp = now;
    userCooldowns.set(author, now);

    console.log(`[YouTubeChatBridge MATCH] Command from ${author}: ${rawMsg}`);
    broadcastCommand(rawMsg, author);
  });

  liveChat.on('error', (err) => {
    console.error('[YouTubeChatBridge Error]', err.message);
  });

  liveChat.on('end', (reason) => {
    console.log(`[YouTubeChatBridge] Live Chat ended (${reason}). Reconnecting in 10s...`);
    setTimeout(startYouTubeChat, 10000);
  });

  liveChat.start().catch((err) => {
    console.error('[YouTubeChatBridge Start Error]', err.message);
    setTimeout(startYouTubeChat, 10000);
  });
}

startYouTubeChat();
