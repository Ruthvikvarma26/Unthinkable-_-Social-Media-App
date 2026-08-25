import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

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
    console.warn('GEMINI_API_KEY missing. Using fallback suggestions.');
    return fallbackSuggestions;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      You are a senior social media strategist and copy editor.
      Analyze the user's extracted text and create 3 to 5 highly specific suggestions tailored to the exact content.
      Do not use generic filler ideas that could apply to any post.
      Tie each suggestion directly to the content, theme, audience, and likely platform behavior in the text.
      Return valid JSON only, with an array of objects shaped like:
      [{"title":"string","content":"string"}]

      The suggestions should be practical and actionable for engagement, reach, and clarity.
      Avoid repeating similar ideas.

      Extracted text:
      ${extractedText}
    `;

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

async function preprocessImageForOCR(buffer: Buffer): Promise<Buffer> {
  const processed = await sharp(buffer)
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 9 })
    .toBuffer();

  return processed;
}

const OCR_TIMEOUT_MS = 30000;

async function withTimeout<T>(task: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), OCR_TIMEOUT_MS);
    }),
  ]);
}

async function extractImageText(buffer: Buffer): Promise<string> {
  const cleanedBuffer = await preprocessImageForOCR(buffer);

  let worker;
  try {
    // Use Tesseract.js with explicit worker configuration for serverless
    const Tesseract = await import('tesseract.js');
    
    worker = await withTimeout(
      Tesseract.createWorker('eng', 1, {
        logger: () => undefined,
      }),
      'Image OCR worker startup timed out after 30 seconds'
    );

    const result = await withTimeout(
      worker.recognize(cleanedBuffer),
      'Image OCR timed out after 30 seconds'
    );

    return result?.data?.text?.trim() || '';
  } catch (error) {
    console.warn('OCR worker failed:', error);
    // Return a helpful error message for serverless environments
    return 'OCR is not available in this environment. Please upload a PDF file for text extraction, or try using the application locally.';
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
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
        extractedText = await extractImageText(buffer);
      } catch (err) {
        console.error('OCR error:', err);
        extractedText = 'Unable to extract readable text from this image. Please upload a clearer image or a PDF.';
      }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      extractedText = 'Image uploaded successfully. OCR could not read this file reliably. Please upload a clearer image or a PDF for the best text extraction.';
    }

    const suggestions = await generateSuggestions(extractedText);

    // Provide lightweight debug info in non-production for troubleshooting
    const debug: Record<string, any> = {};
    if (process.env.NODE_ENV !== 'production') {
      debug.hasGeminiKey = !!process.env.GEMINI_API_KEY;
      debug.extractedLength = (extractedText || '').length;
      debug.usedFallback = extractedText.includes('Unable to extract') || extractedText.includes('OCR could not read');
    }

    return NextResponse.json({
      text: extractedText,
      suggestions,
      debug: Object.keys(debug).length ? debug : undefined,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
