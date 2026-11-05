// Configuración de pm2. Arranca con `pm2 start ecosystem.config.cjs` desde la raíz del proyecto.
// Compila antes con `npm run build`.
module.exports = {
  apps: [
    {
      name: process.env.PM2_NAME || 'CYALTRONIC',
      script: 'dist/index.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
