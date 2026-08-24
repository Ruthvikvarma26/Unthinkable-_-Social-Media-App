import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import Tesseract from 'tesseract.js';
import { GoogleGenAI } from '@google/genai';

const pdfWorkerUrl = pathToFileURL(
  path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
).href;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const runtime = 'nodejs';
export const maxDuration = 60;

const fallbackSuggestions = [
  {
    title: 'Strong Hook',
    content: 'Start with a provocative question or a surprising fact to grab attention immediately.',
  },
  {
    title: 'Shorter Paragraphs',
    content: 'Break long sections into shorter, punchier paragraphs to improve readability on mobile.',
  },
  {
    title: 'Clear CTA',
    content: 'End with a direct call to action that tells people exactly what to do next.',
  },
];

function normalizeSuggestions(input: unknown): { title: string; content: string }[] {
  if (!Array.isArray(input)) return fallbackSuggestions;

  const normalized = input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title : 'Improvement Idea',
      content: typeof item.content === 'string' ? item.content : 'Add a sharper CTA and clearer structure.',
    }))
    .filter((item) => item.title && item.content);

  return normalized.length > 0 ? normalized.slice(0, 5) : fallbackSuggestions;
}

async function generateSuggestions(extractedText: string) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return fallbackSuggestions;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an expert social media strategist. Analyze the text below and provide 3-5 specific, actionable suggestions to improve engagement. Return only valid JSON array with objects: {"title":"string","content":"string"}.\n\nText:\n${extractedText}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const raw = String(response?.text || '[]').trim();
    const parsed = JSON.parse(raw);
    return normalizeSuggestions(parsed);
  } catch (error) {
    console.error('Gemini suggestions failed:', error);
    return fallbackSuggestions;
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text || '';
  } catch (primaryError) {
    console.warn('pdf-parse failed, falling back to pdfjs-dist:', primaryError);
  }

  const pdfData = new Uint8Array(buffer);
  const pdf = await getDocument({
    data: pdfData,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let combinedText = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) {
      combinedText += `${pageText}\n\n`;
    }

    page.cleanup();
  }

  return combinedText.trim();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let extractedText = '';

    if (file.type === 'application/pdf') {
      try {
        extractedText = await extractPdfText(buffer);
      } catch (err) {
        console.error('PDF parsing error:', err);
        return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 500 });
      }
    } else {
      try {
        const result = await Tesseract.recognize(buffer, 'eng');
        extractedText = result.data.text;
      } catch (err) {
        console.error('OCR error:', err);
        return NextResponse.json({ error: 'Failed to extract text from image' }, { status: 500 });
      }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return NextResponse.json({ error: 'No text could be extracted from the file' }, { status: 400 });
    }

    const suggestions = await generateSuggestions(extractedText);

    return NextResponse.json({
      text: extractedText,
      suggestions,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
