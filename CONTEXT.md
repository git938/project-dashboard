# 项目上下文

> 完整版在 VPS：`/root/AI-SESSION-CONTEXT.md`

## 项目简介
Project Dashboard - 项目管理工具（WBS + Kanban + Gantt）。

部署：http://162.43.92.249:3004

## 技术栈
- 前端：HTML + JS + CSS
- 后端：Node.js 24 + Fastify 5.x
- 数据库：MySQL 8.0
- 端口：127.0.0.1:3100
- 认证：Nginx Basic Auth
- 进程：systemd

## 开发约定
- 后端开发：Codex（本地 Mac）
- 部署：Claude（VPS）
- 协调：用户

## 目录结构
project-dashboard/
├── dist/ # 前端
├── api/ # 后端（Fastify）
├── db/ # schema + migrations
├── deploy/ # systemd + nginx
├── .env.example
└── README.md

text

## API 端点
详见 api/openapi.json（Codex 提供）。

## 部署
详见 README.md（Codex 提供）。

## 联系
- GitHub: git938
- VPS: 162.43.92.249
