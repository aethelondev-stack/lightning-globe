const { WebSocketServer, WebSocket } = require('ws');

const KICK_PUSHER_URL = 'wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false';
const KICK_CHATROOM_ID = process.env.KICK_CHATROOM_ID || '127326358';
const INTERNAL_PORT = parseInt(process.env.STREAM_WS_PORT || '3001', 10);

// Global anti-spam cooldown (ms)
const GLOBAL_COOLDOWN_MS = 4000;
let lastCommandTimestamp = 0;

// Valid commands set
const VALID_COMMANDS = new Set([
  '!turkiye', '!turk', '!tr',
  '!firtina', '!storm',
  '!dunya', '!world',
  '!oto', '!auto',
  '!zoom',
  '!uzaklas', '!out',
  '!avrupa', '!europe',
  '!amerika', '!usa',
  '!asya', '!asia',
  '!japonya', '!japan'
]);

// 1. Start Internal WebSocket Server for the Globe Browser Client
const wss = new WebSocketServer({ port: INTERNAL_PORT }, () => {
  console.log(`[KickChatBridge] Internal WebSocket server listening on ws://127.0.0.1:${INTERNAL_PORT}`);
});

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[KickChatBridge] Frontend client connected (Total: ${clients.size})`);
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[KickChatBridge] Frontend client disconnected (Remaining: ${clients.size})`);
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

// 2. Connect to Kick Pusher WebSocket Stream
let pusherWs = null;
let reconnectTimer = null;

function connectKickPusher() {
  console.log(`[KickChatBridge] Connecting to Kick Pusher stream (Channel: chatrooms.${KICK_CHATROOM_ID}.v2)...`);
  
  pusherWs = new WebSocket(KICK_PUSHER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });

  pusherWs.on('open', () => {
    console.log('[KickChatBridge] Connected to Kick Pusher gateway.');
  });

  pusherWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // On connection established -> subscribe to chatroom channel
      if (msg.event === 'pusher:connection_established') {
        const subscribePayload = {
          event: 'pusher:subscribe',
          data: {
            auth: '',
            channel: `chatrooms.${KICK_CHATROOM_ID}.v2`
          }
        };
        pusherWs.send(JSON.stringify(subscribePayload));
        console.log(`[KickChatBridge] Subscribed to chatrooms.${KICK_CHATROOM_ID}.v2`);
        return;
      }

      // Handle chat message event
      if (msg.event === 'App\\Events\\ChatMessageEvent') {
        const chatData = JSON.parse(msg.data);
        const content = (chatData.content || '').trim();
        const username = chatData.sender?.username || 'Viewer';

        // Check if message is a command
        const firstWord = content.split(/\s+/)[0].toLowerCase();
        if (VALID_COMMANDS.has(firstWord)) {
          const now = Date.now();
          if (now - lastCommandTimestamp < GLOBAL_COOLDOWN_MS) {
            console.log(`[KickChatBridge] Cooldown active, skipped: ${firstWord} from ${username}`);
            return;
          }

          lastCommandTimestamp = now;
          console.log(`⚡ [KickChatBridge] DISPATCHING COMMAND: ${firstWord} by @${username}`);
          broadcastCommand(firstWord, username);
        }
      }

      // Ping-pong to keep connection alive
      if (msg.event === 'pusher:ping') {
        pusherWs.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      }
    } catch (err) {
      console.warn('[KickChatBridge] Message parse error:', err.message);
    }
  });

  pusherWs.on('close', (code, reason) => {
    console.warn(`[KickChatBridge] Kick Pusher closed (${code}: ${reason}). Reconnecting in 5s...`);
    schedulePusherReconnect();
  });

  pusherWs.on('error', (err) => {
    console.error('[KickChatBridge] Kick Pusher error:', err.message);
    pusherWs.close();
  });
}

function schedulePusherReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectKickPusher();
  }, 5000);
}

// Start connection
connectKickPusher();
