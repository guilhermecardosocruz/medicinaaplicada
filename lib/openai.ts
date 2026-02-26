import OpenAI from "openai";

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");
  return new OpenAI({ apiKey });
}

export function getOpenAIModel() {
  // Modelo barato e bom para MVP (pode trocar depois via env)
  return process.env.OPENAI_MODEL || "gpt-4o";
}
