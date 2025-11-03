import { NextResponse } from "next/server";
import OpenAI from "openai";
import { ResumeData } from "@/types/resume";
import { createEmptyResumeTemplate } from "@/utils/resumeTemplate";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Extract text from PDF using pdf-parse
    let extractedText = await extractTextFromPDF(buffer);

    // If text is too short, fallback to image-based extraction
    if (extractedText.length < 30) {
      try {
        extractedText = await extractImagesAsBase64(buffer);
      } catch {
        // If image extraction fails due to size, return error
        throw new Error(
          "PDF appears to be image-based but the image is too large to process. Please use a smaller PDF or ensure it's text-based."
        );
      }
    }

    // Get the JSON template for the schema
    const JSON_TEMPLATE = createEmptyResumeTemplate();

    // --- OpenAI API call ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume parser. Your task is to extract all available information from the resume text or OCR data and populate the JSON structure. Extract every piece of information you can find - names, emails, work experience, education, skills, etc. Do NOT leave fields empty if the information exists in the resume. Only leave fields empty if the information is truly not present in the resume.",
        },
        {
          role: "user",
          content: `Extract all information from the following resume data and populate the JSON structure. Fill in ALL fields with actual data from the resume. Only leave fields empty if the information is not available in the resume.\n\nResume content:\n${extractedText.substring(
            0,
            50000
          )}\n\nReturn a complete JSON object matching this schema with all available data extracted:\n${JSON.stringify(
            JSON_TEMPLATE,
            null,
            2
          )}\n\nInstructions:
          1. Extract the person's name and split it into name and surname fields
          2. Extract email address if present
          3. Extract all work experience with job titles, companies, dates, and descriptions
          4. Extract all education with schools, degrees, majors, and dates
          5. Extract all skills listed
          6. Extract licenses, languages, achievements, publications, and honors if mentioned
          7. For dates: extract startMonth (1-12), startYear (number), endMonth (number or null), endYear (number or null), current (boolean)
          8. For employmentType use: FULL_TIME, PART_TIME, INTERNSHIP, or CONTRACT (infer if not explicitly stated)
          9. For locationType use: ONSITE, REMOTE, or HYBRID (infer if not explicitly stated)
          10. For degree use: HIGH_SCHOOL, ASSOCIATE, BACHELOR, MASTER, or DOCTORATE (infer based on common degree names)
          11. For language level use: BEGINNER, INTERMEDIATE, ADVANCED, or NATIVE (infer if not explicitly stated)
          12. Extract professional summary/objective if present
          13. Extract LinkedIn, website, location (country, city), and work preferences if mentioned
          14. Return dates in YYYY-MM format where applicable (for achievements, publications)
          15. Use ISO8601 format for publicationDate
          
          IMPORTANT: Do not return empty strings or empty arrays unless the information is truly not in the resume. Extract everything you can find!`,
        },
      ],
    });

    const jsonResult = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as ResumeData;

    return NextResponse.json(jsonResult);
  } catch (err: unknown) {
    console.error(err);
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error occurred";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// GET endpoint for testing and info
export async function GET() {
  return NextResponse.json({
    message: "PDF Resume Extractor API",
    endpoint: "/api/extract",
    method: "POST",
    description: "Upload a PDF resume to extract structured data",
    requiredFields: {
      file: "PDF file (multipart/form-data)",
    },
    environmentVariables: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✓ Set" : "✗ Not set",
    },
  });
}

// --- Helper: extract text from text-based PDF pages ---
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // Use pdf-parse for text extraction (simpler, no worker issues)
  const { createRequire } = await import("module");
  const require = createRequire(
    new URL(import.meta.url).pathname || process.cwd() + "/package.json"
  );
  const { PDFParse } = require("pdf-parse");

  if (typeof PDFParse !== "function") {
    throw new Error("PDFParse class not found");
  }

  // PDFParse is a class, instantiate it and call getText()
  const pdfParser = new PDFParse({ data: buffer });
  const result = await pdfParser.getText();
  const extractedText = result?.text?.trim() || "";

  return extractedText;
}

// --- Helper: convert image-only PDF pages to base64 for GPT OCR ---
async function extractImagesAsBase64(buffer: Buffer) {
  // Use pdf-parse's getScreenshot method which handles image extraction better
  const { createRequire } = await import("module");
  const require = createRequire(
    new URL(import.meta.url).pathname || process.cwd() + "/package.json"
  );
  const { PDFParse } = require("pdf-parse");

  // Use PDFParse class to get screenshots of PDF pages
  // Use very low scale and small width to reduce token usage significantly
  const pdfParser = new PDFParse({ data: buffer });
  const screenshotResult = await pdfParser.getScreenshot({
    first: 1,
    last: 1, // Only first page to reduce token usage
    scale: 0.2, // Very low scale (20%) to make images much smaller (minimizes tokens)
    imageDataUrl: true,
    imageBuffer: false,
    desiredWidth: 400, // Very small width to keep token count low
  });

  const pages: string[] = [];

  // Extract base64 images from screenshot result (only first page to avoid token limit)
  for (const pageData of screenshotResult.pages || []) {
    if (pageData.dataUrl) {
      pages.push(pageData.dataUrl);
      break;
    }
  }

  if (pages.length === 0) {
    throw new Error("Failed to extract images from PDF");
  }

  const imageData = pages[0];
  const imageSize = imageData.length;

  // If image is too large (base64 size > 500KB), return error
  if (imageSize > 500000) {
    throw new Error(
      `Image is too large (${(imageSize / 1024).toFixed(
        0
      )}KB base64). Please use a smaller PDF or ensure it's text-based.`
    );
  }

  return `This PDF contains scanned images. Please perform OCR on the following base64-encoded PNG image and extract the resume data:\n${imageData}`;
}
