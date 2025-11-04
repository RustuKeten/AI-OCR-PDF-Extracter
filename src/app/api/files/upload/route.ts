/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumeData } from "@/types/resume";
import { createEmptyResumeTemplate } from "@/utils/resumeTemplate";
import { reorderResumeData } from "@/utils/resumeOrder";
import { getOpenAI } from "@/lib/openai";
import { promises as fs } from "fs";
import { v4 as uuidv4 } from "uuid";
import PDFParser from "pdf2json";

export const runtime = "nodejs";
export const maxDuration = 60;
const CREDITS_REQUIRED = 100;

export async function POST(req: Request) {
  let fileRecord: { id: string; fileName: string; fileSize: number } | null =
    null;
  let userId: string | undefined = undefined;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true, planType: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.credits < CREDITS_REQUIRED) {
      const upgradeMessage =
        user.planType === "FREE"
          ? "Please subscribe to a plan to get more credits, or wait for your subscription to renew."
          : "Please top up your credits or wait for your subscription to renew.";

      return NextResponse.json(
        {
          error: "Insufficient credits",
          message: `You need ${CREDITS_REQUIRED} credits to process a file. You have ${user.credits} credits remaining. ${upgradeMessage}`,
          creditsRemaining: user.credits,
          creditsRequired: CREDITS_REQUIRED,
        },
        { status: 402 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // --- Create file record ---
    fileRecord = await prisma.file.create({
      data: {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || "application/pdf",
        userId: userId,
        status: "processing",
      },
    });

    await prisma.resumeHistory.create({
      data: {
        userId,
        fileId: fileRecord.id,
        action: "upload",
        status: "success",
        message: "File uploaded successfully",
      },
    });

    // --- Extract text from PDF using pdf2json (matches PDF-Scraper-App) ---
    console.log(
      `[Upload] Starting PDF text extraction for file: ${file.name} (${file.size} bytes)`
    );

    const extractedText = await extractTextFromPDF(buffer);
    let isImageBased = false;

    console.log(
      `[Upload] PDF text extraction complete. Extracted ${extractedText.length} characters`
    );

    const JSON_TEMPLATE = createEmptyResumeTemplate();
    const openai = getOpenAI();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[];

    if (extractedText.length < 50) {
      // Image-based PDF detected
      try {
        const imageDataUrl = await extractImagesAsBase64(buffer);
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
      } catch (error) {
        console.error("[Upload] Image extraction error:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // Check if it's a worker-related error
        if (errorMsg.includes("worker") || errorMsg.includes("pdfjs-dist")) {
          throw new Error(
            "Image-based PDF processing is currently unavailable. Please convert your PDF to a text-based format or use a different PDF file."
          );
        }
        
        // Generic user-friendly error message
        throw new Error(
          "Unable to process this image-based PDF. Please ensure the PDF is in a standard format or convert it to a text-based PDF."
        );
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

    let resumeData = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as ResumeData;

    resumeData = reorderResumeData(resumeData);

    await prisma.resumeData.create({
      data: { userId, fileId: fileRecord.id, data: resumeData as any },
    });

    await prisma.file.update({
      where: { id: fileRecord.id },
      data: { status: "completed" },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: CREDITS_REQUIRED } },
    });

    await prisma.resumeHistory.create({
      data: {
        userId,
        fileId: fileRecord.id,
        action: "extract",
        status: "success",
        message: "Resume data extracted successfully",
      },
    });

    return NextResponse.json({
      success: true,
      file: {
        id: fileRecord.id,
        fileName: fileRecord.fileName,
        fileSize: fileRecord.fileSize,
        status: "completed",
      },
      resumeData,
    });
  } catch (error: unknown) {
    console.error("[Upload] Processing error:", error);
    
    // Get user-friendly error message
    let userMessage = "Failed to process PDF. Please try again or use a different file.";
    
    if (error instanceof Error) {
      const errorMsg = error.message;
      
      // Map technical errors to user-friendly messages
      if (errorMsg.includes("worker") || errorMsg.includes("pdfjs-dist") || errorMsg.includes("Cannot find module")) {
        userMessage = "Image-based PDF processing is currently unavailable. Please use a text-based PDF or convert your PDF to a text-based format.";
      } else if (errorMsg.includes("Insufficient credits")) {
        userMessage = errorMsg; // Keep credit errors as-is
      } else if (errorMsg.includes("image-based") || errorMsg.includes("OCR")) {
        userMessage = "Unable to process this image-based PDF. Please ensure the PDF contains selectable text or convert it to a text-based PDF.";
      } else if (errorMsg.includes("timeout")) {
        userMessage = "PDF processing timed out. Please try with a smaller file or ensure the PDF is not corrupted.";
      } else if (errorMsg.includes("corrupted") || errorMsg.includes("invalid")) {
        userMessage = "The PDF file appears to be corrupted or invalid. Please try with a different PDF file.";
      } else if (errorMsg.length < 200) {
        // If error message is short and user-friendly, use it
        userMessage = errorMsg;
      }
    }

    // Update file status to failed if fileRecord was created
    try {
      if (fileRecord?.id && userId) {
        await prisma.file.update({
          where: { id: fileRecord.id },
          data: { status: "failed" },
        });

        await prisma.resumeHistory.create({
          data: {
            userId,
            fileId: fileRecord.id,
            action: "extract",
            status: "failed",
            message: `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        });
      }
    } catch (updateError) {
      console.error("[Upload] Failed to update file status:", updateError);
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}

/**
 * Extract text from PDF using pdf2json (matches PDF-Scraper-App implementation)
 * This is the working text extraction method from PDF-Scraper-App
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // Use pdf2json for text extraction (migrated from working PDF-Scraper-App)
  const fileName = uuidv4();
  const tempFilePath = `/tmp/${fileName}.pdf`;

  console.log(
    `[PDF Extraction] Starting extraction with pdf2json. Buffer size: ${buffer.length} bytes, temp file: ${tempFilePath}`
  );
  try {
    // Write buffer to temporary file (required by pdf2json)
    await fs.writeFile(tempFilePath, buffer);
    console.log(`[PDF Extraction] Temporary file created: ${tempFilePath}`);

    // Create PDFParser instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParser = new (PDFParser as any)(null, 1);

    // Use Promise-based approach with event handlers and timeout
    const parsedText = await Promise.race([
      new Promise<string>((resolve, reject) => {
        let resolved = false;

        pdfParser.on("pdfParser_dataError", (errData: unknown) => {
          const errorData = errData as { parserError?: string };
          if (!resolved) {
            resolved = true;
            reject(new Error(errorData?.parserError || "PDF parsing error"));
          }
        });

        pdfParser.on("pdfParser_dataReady", () => {
          if (!resolved) {
            resolved = true;
            try {
              // getRawTextContent() can throw RangeError with Infinity for malformed PDFs
              const textContent = pdfParser.getRawTextContent() || "";
              resolve(textContent.trim());
            } catch (error) {
              // If getRawTextContent() throws, resolve with empty string to trigger OCR fallback
              console.warn(
                "[PDF Extraction] getRawTextContent() failed, will trigger OCR fallback:",
                error
              );
              resolve("");
            }
          }
        });

        pdfParser.loadPDF(tempFilePath);
      }),
      // Timeout after 30 seconds to prevent hanging
      new Promise<string>((_, reject) => {
        setTimeout(() => {
          reject(new Error("PDF parsing timeout after 30 seconds"));
        }, 30000);
      }),
    ]);

    // Clean up temp file
    try {
      await fs.unlink(tempFilePath);
    } catch (unlinkError) {
      console.warn("[PDF Extraction] Failed to delete temp file:", unlinkError);
    }

    console.log(`[PDF Extraction] Extracted ${parsedText.length} characters`);
    return parsedText;
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempFilePath);
    } catch (unlinkError) {
      console.warn("[PDF Extraction] Failed to delete temp file:", unlinkError);
    }

    console.error("[PDF Extraction] Error:", error);
    throw new Error(
      `Failed to extract text from PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function extractImagesAsBase64(buffer: Buffer): Promise<string> {
  // Attempt to use pdf-parse with worker configuration for image extraction
  // Configure pdfjs-dist to disable workers before importing pdf-parse
  
  try {
    // Set environment variables to disable workers
    process.env.PDFJS_DISABLE_WORKER = "true";
    
    // Load DOMMatrix polyfill first
    await import("@/lib/dom-matrix-polyfill");
    
    // Note: pdfjs-dist is bundled inside pdf-parse, so we can't configure it directly
    // The DOMMatrix polyfill should be sufficient for basic functionality
    
    const pdfParseModule = await import("pdf-parse");
    const PDFParse = (pdfParseModule as any).PDFParse;
    const pdfParser = new PDFParse({ data: buffer });

    const screenshotResult = await pdfParser.getScreenshot({
      first: 1,
      last: 1,
      scale: 0.5,
      imageDataUrl: true,
      imageBuffer: false,
      desiredWidth: 1200,
    });

    const pages: string[] = [];

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

    if (imageSize > 4000000) {
      throw new Error(
        `Image is too large (${(imageSize / 1024).toFixed(0)}KB base64). Please use a smaller PDF.`
      );
    }

    return imageData;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // If it's a worker error, throw a user-friendly message
    if (errorMsg.includes("worker") || errorMsg.includes("pdfjs-dist") || errorMsg.includes("Cannot find module")) {
      throw new Error(
        "Image-based PDF processing is currently unavailable. Please use a text-based PDF or convert your scanned PDF to a text-based format."
      );
    }
    
    // Re-throw other errors
    throw error;
  }
}
