// CRITICAL: DOMMatrix polyfill must be imported BEFORE any pdf-parse imports
import "@/lib/dom-matrix-polyfill";

import { NextResponse } from "next/server";
import { ResumeData } from "@/types/resume";
import { createEmptyResumeTemplate } from "@/utils/resumeTemplate";
import { reorderResumeData } from "@/utils/resumeOrder";
import { getOpenAI } from "@/lib/openai";

/* eslint-disable @typescript-eslint/no-explicit-any */
let pdfParse: any;

async function initPdfTools() {
  if (!pdfParse) {
    const pdfParseModule = await import("pdf-parse");
    // PDFParse is exported as a named export, not default
    pdfParse = (pdfParseModule as any).PDFParse;
    if (!pdfParse || typeof pdfParse !== "function") {
      throw new Error("PDFParse class not found in pdf-parse module");
    }
  }
  return pdfParse;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await initPdfTools();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // --- Step 1: Extract text from PDF using pdf-parse (works on Vercel) ---
    console.log(
      `[Extract] Starting PDF text extraction for file: ${file.name} (${file.size} bytes)`
    );

    const PDFParse = await initPdfTools();
    const pdfParser = new PDFParse({ data: buffer });
    const pdfData = await pdfParser.getText();
    const extractedText = pdfData.text?.trim() || "";
    let isImageBased = false;

    console.log(
      `[Extract] PDF text extraction complete. Extracted ${extractedText.length} characters`
    );

    // --- Step 2: Check if image-based and prepare messages ---
    const JSON_TEMPLATE = createEmptyResumeTemplate();
    const openai = getOpenAI();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[];

    if (extractedText.length < 50) {
      console.log("Detected image-based PDF — running OCR...");
      const imageDataUrl = await extractImagesWithOCR(buffer);
      isImageBased = true;

      // Extract base64 image from data URL
      const imageMatch = imageDataUrl.match(
        /data:image\/[^;]+;base64,([^\s\n]+)/
      );
      if (imageMatch && imageMatch[1]) {
        const base64Image = imageMatch[1];
        messages = [
          {
            role: "system",
            content:
              "You are an expert resume parser. Your task is to extract all available information from the resume image using OCR and populate the JSON structure. Extract every piece of information you can find - names, emails, work experience, education, skills, etc. Do NOT leave fields empty if the information exists in the resume. Only leave fields empty if the information is truly not present in the resume.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract all information from this resume image and populate the JSON structure. Fill in ALL fields with actual data from the resume. Only leave fields empty if the information is not available in the resume.\n\nReturn a complete JSON object matching this schema with all available data extracted:\n${JSON.stringify(
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
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ];
      } else {
        // Fallback to text-based if image extraction failed
        messages = [
          {
            role: "system",
            content:
              "You are an expert resume parser. Your task is to extract all available information from the resume text or OCR data and populate the JSON structure. Extract every piece of information you can find - names, emails, work experience, education, skills, etc. Do NOT leave fields empty if the information exists in the resume. Only leave fields empty if the information is truly not present in the resume.",
          },
          {
            role: "user",
            content: extractedText.substring(0, 50000),
          },
        ];
        isImageBased = false;
      }
    } else {
      // Text-based PDF processing
      messages = [
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
      ];
    }

    const completion = await openai.chat.completions.create({
      model: isImageBased ? "gpt-4o" : "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages,
    });

    let result = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as ResumeData;

    result = reorderResumeData(result);

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Extraction error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * OCR: Extract embedded images from PDF (no canvas required)
 * This works in Vercel serverless environment
 * Strategy: Search for JPEG/PNG markers in PDF buffer
 */
async function extractImagesWithOCR(buffer: Buffer): Promise<string> {
  try {
    const { PDFDocument } = await import("pdf-lib");

    // Load the PDF document
    const pdfDoc = await PDFDocument.load(buffer);

    // Get the first page
    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
      throw new Error("PDF has no pages");
    }

    // Search for embedded JPEG/PNG images in the PDF buffer
    // Many scanned PDFs store images as raw JPEG/PNG streams
    const images: { data: Uint8Array; mimeType: string }[] = [];

    // Look for JPEG markers (FF D8 FF) - common in scanned PDFs
    const jpegStart = buffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    if (jpegStart !== -1) {
      // Try to find JPEG end marker (FF D9)
      const jpegEnd = buffer.indexOf(Buffer.from([0xff, 0xd9]), jpegStart);
      if (jpegEnd !== -1) {
        const jpegData = buffer.slice(jpegStart, jpegEnd + 2);
        if (jpegData.length > 1000 && jpegData.length < 5000000) {
          // Valid JPEG size
          images.push({ data: jpegData, mimeType: "image/jpeg" });
        }
      }
    }

    // Look for PNG markers (89 50 4E 47)
    const pngStart = buffer.indexOf(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    if (pngStart !== -1) {
      // PNG has IEND marker at the end
      const pngIend = buffer.indexOf(Buffer.from("IEND"), pngStart);
      if (pngIend !== -1) {
        const pngData = buffer.slice(pngStart, pngIend + 8); // +8 for IEND marker
        if (pngData.length > 1000 && pngData.length < 5000000) {
          // Valid PNG size
          images.push({ data: pngData, mimeType: "image/png" });
        }
      }
    }

    // If we found embedded images, use the first one
    if (images.length > 0) {
      const image = images[0];

      // Convert to base64 data URL
      const base64Image = Buffer.from(image.data).toString("base64");
      const dataUrl = `data:${image.mimeType};base64,${base64Image}`;

      // Check size (OpenAI has a 20MB limit, but we're being conservative)
      if (dataUrl.length > 4000000) {
        throw new Error(
          `Image is too large (${(dataUrl.length / 1024).toFixed(
            0
          )}KB base64). Please use a smaller PDF.`
        );
      }

      return dataUrl;
    }

    // If no embedded images found, this PDF might not be a scanned PDF
    throw new Error(
      "No embedded images found in PDF. This PDF may not be a scanned/image-based PDF, or it uses vector graphics that cannot be extracted without rendering."
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // If it's a canvas/rendering error, provide a helpful message
    if (
      errorMsg.includes("canvas") ||
      errorMsg.includes("rendering") ||
      errorMsg.includes("worker") ||
      errorMsg.includes("pdfjs-dist") ||
      errorMsg.includes("Cannot find module")
    ) {
      throw new Error(
        "Image-based PDF processing is currently unavailable. Please use a text-based PDF or convert your scanned PDF to a text-based format."
      );
    }

    // Re-throw other errors
    throw error;
  }
}
