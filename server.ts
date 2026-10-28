/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI} from '@google/genai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY or API_KEY environment variable is required on the server.',
    );
  }
  return key;
}

const MODEL_UPGRADES: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-3-flash-preview',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-pro-exp-03-25': 'gemini-3.1-pro-preview',
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-2.0-flash': 'gemini-3-flash-preview',
  'gemini-2.0-flash-exp': 'gemini-3-flash-preview',
  'gemini-2.0-flash-preview-image-generation': 'gemini-2.5-flash-image',
};

function resolveModel(model?: string): string {
  if (!model) return 'gemini-3-flash-preview';
  return MODEL_UPGRADES[model] || model;
}

function getAI(): GoogleGenAI {
  return new GoogleGenAI({apiKey: getApiKey()});
}

function serializeResponse(response: any) {
  return {
    text: response?.text ?? '',
    candidates: response?.candidates ?? [],
    functionCalls: response?.functionCalls ?? undefined,
    groundingMetadata:
      response?.candidates?.[0]?.groundingMetadata ?? undefined,
    usageMetadata: response?.usageMetadata ?? undefined,
    promptFeedback: response?.promptFeedback ?? undefined,
  };
}

function normalizeMessage(msg: any): any {
  if (Array.isArray(msg)) {
    return msg.map((item) => {
      if (
        item &&
        typeof item === 'object' &&
        'role' in item &&
        'text' in item &&
        !('parts' in item)
      ) {
        return {text: item.text};
      }
      return item;
    });
  }
  return msg;
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '50mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      hasKey: Boolean(process.env.GEMINI_API_KEY || process.env.API_KEY),
    });
  });

  app.post('/api/generate-content', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, contents, config} = req.body;
      const response = await ai.models.generateContent({
        model: resolveModel(rawModel),
        contents,
        config,
      });
      res.json(serializeResponse(response));
    } catch (error: any) {
      console.error('Error in /api/generate-content:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/generate-content-stream', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, contents, config} = req.body;
      const responseStream = await ai.models.generateContentStream({
        model: resolveModel(rawModel),
        contents,
        config,
      });

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');

      for await (const chunk of responseStream) {
        res.write(JSON.stringify(serializeResponse(chunk)) + '\n');
      }
      res.end();
    } catch (error: any) {
      console.error('Error in /api/generate-content-stream:', error);
      if (!res.headersSent) {
        res
          .status(error?.status || 500)
          .json({error: error.message || String(error)});
      } else {
        res.write(
          JSON.stringify({error: error.message || String(error)}) + '\n',
        );
        res.end();
      }
    }
  });

  app.post('/api/generate-images', async (req, res) => {
    try {
      const ai = getAI();
      const {model, prompt, config} = req.body;
      const response = await ai.models.generateImages({
        model: resolveModel(model),
        prompt,
        config,
      });
      res.json(response);
    } catch (error: any) {
      console.error('Error in /api/generate-images:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/files-upload', async (req, res) => {
    const {displayName, mimeType, base64Data} = req.body;
    const safeName = String(displayName || 'upload').replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    const tmpPath = path.join('/tmp', `${Date.now()}-${safeName}`);
    try {
      const ai = getAI();
      fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
      const uploaded = await ai.files.upload({
        file: tmpPath,
        config: {displayName, mimeType},
      });
      res.json(uploaded);
    } catch (error: any) {
      console.error('Error in /api/files-upload:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
    }
  });

  app.post('/api/files-get', async (req, res) => {
    try {
      const ai = getAI();
      const fileInfo = await ai.files.get({name: req.body.name});
      res.json(fileInfo);
    } catch (error: any) {
      console.error('Error in /api/files-get:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, config, history, message} = req.body;
      const chat = ai.chats.create({
        model: resolveModel(rawModel),
        config,
        history: history || [],
      });
      const rawMsg =
        typeof message === 'object' && message !== null && 'message' in message
          ? message.message
          : message;
      const msgPayload = normalizeMessage(rawMsg);
      const response = await chat.sendMessage({message: msgPayload});
      res.json({
        ...serializeResponse(response),
        history: await chat.getHistory(),
      });
    } catch (error: any) {
      console.error('Error in /api/chat:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/chat-stream', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, config, history, message} = req.body;
      const chat = ai.chats.create({
        model: resolveModel(rawModel),
        config,
        history: history || [],
      });
      const rawMsg =
        typeof message === 'object' && message !== null && 'message' in message
          ? message.message
          : message;
      const msgPayload = normalizeMessage(rawMsg);
      const responseStream = await chat.sendMessageStream({
        message: msgPayload,
      });

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');

      for await (const chunk of responseStream) {
        res.write(JSON.stringify(serializeResponse(chunk)) + '\n');
      }
      res.end();
    } catch (error: any) {
      console.error('Error in /api/chat-stream:', error);
      if (!res.headersSent) {
        res
          .status(error?.status || 500)
          .json({error: error.message || String(error)});
      } else {
        res.write(
          JSON.stringify({error: error.message || String(error)}) + '\n',
        );
        res.end();
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
