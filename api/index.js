// Vercel Serverless 入口：所有 /api/* 请求经 vercel.json rewrite 到这里，由 Express 分发。
import app from '../src/app.js';

export default app;
