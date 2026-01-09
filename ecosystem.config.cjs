module.exports = {
  apps: [{
    name: 'CYALTRONIC',
    script: 'npx',
    args: 'tsx src/index.ts',
    cwd: '/home/dev3/cyalbot/CYALTRONIC',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
