module.exports = {
  apps: [
    {
      name: "backend-node",
      cwd: "/home/anyamanode/backend-node",
      script: "./dist/src/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1100M",
      env: {
        PORT: "3001",
        NODE_OPTIONS: "--max-old-space-size=1024",
      },
    },
    {
      name: "frontend-node",
      cwd: "/home/anyamanode/frontend-node",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "800M",
      env: {
        PORT: "3000",
        NODE_OPTIONS: "--max-old-space-size=512",
      },
    },
  ],
};