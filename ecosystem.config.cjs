module.exports = {
  apps: [
    {
      name: 'lightning-vite',
      cwd: '/home/ubuntu/lightning-globe',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host 127.0.0.1 --port 3000',
      env: {
        NODE_ENV: 'production'
      },
      restart_delay: 3000,
      max_restarts: 10
    },
    {
      name: 'kick-chat-bridge',
      cwd: '/home/ubuntu/lightning-globe',
      script: 'server/KickChatBridge.cjs',
      restart_delay: 4000,
      max_restarts: 20
    }
  ]
};
