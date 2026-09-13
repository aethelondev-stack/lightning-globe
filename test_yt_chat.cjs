const { LiveChat } = require('youtube-chat');

const LIVE_ID = 'mLkBRGzbkE4';
const liveChat = new LiveChat({ liveId: LIVE_ID });

liveChat.on('start', (initialLiveId) => {
  console.log(`[YouTubeChat] Successfully started for ${initialLiveId}!`);
});

liveChat.on('chat', (chatItem) => {
  const author = chatItem.author.name;
  const message = chatItem.message.map((m) => m.text).join('');
  console.log(`[YouTubeChat MATCH] ${author}: ${message}`);
});

liveChat.on('error', (err) => {
  console.error('[YouTubeChat Error]', err.message);
});

liveChat.start().then((ok) => {
  console.log(`[YouTubeChat] Connected to stream ${LIVE_ID}: ${ok}`);
}).catch((err) => {
  console.error('[YouTubeChat Start Failed]', err.message);
});
