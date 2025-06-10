import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  splitting: false,
  minify: false,
  target: 'node18',
  external: [
    'playwright',
    '@anthropic-ai/sdk',
    'openai',
    'ai',
    '@ai-sdk/anthropic',
    '@ai-sdk/openai',
    '@ai-sdk/amazon-bedrock',
    'ollama-ai-provider',
    'pino',
    'pino-pretty',
    'zod'
  ]
});