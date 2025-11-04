/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumeData } from "@/types/resume";
import { createEmptyResumeTemplate } from "@/utils/resumeTemplate";
import { reorderResumeData } from "@/utils/resumeOrder";
import { getOpenAI } from "@/lib/openai";

let pdfParse: any;

async function initPdfParse() {
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

export const runtime = "nodejs";
export const maxDuration = 60;
const CREDITS_REQUIRED = 100;

export async function POST(req: Request) {
  let fileRecord: { id: string; fileName: string; fileSize: number } | null = null;
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

    // --- Extract text from PDF using pdf-parse (works on Vercel) ---
    console.log(
      `[Upload] Starting PDF text extraction for file: ${file.name} (${file.size} bytes)`
    );
    
    const PDFParse = await initPdfParse();
    const pdfParser = new PDFParse({ data: buffer });
    const pdfData = await pdfParser.getText();
    let extractedText = pdfData.text?.trim() || "";
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
        throw new Error(
          `PDF appears to be image-based but could not be processed. ${errorMsg}. Please try a different PDF or ensure it's text-based.`
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
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    
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
            message: `Processing failed: ${message}`,
          },
        });
      }
    } catch (updateError) {
      console.error("[Upload] Failed to update file status:", updateError);
    }
    
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function extractImagesAsBase64(buffer: Buffer): Promise<string> {
  // Use pdf-parse's getScreenshot method (works in Vercel serverless)
  const PDFParse = await initPdfParse();
  const pdfParser = new PDFParse({ data: buffer });

  const screenshotResult = await pdfParser.getScreenshot({
    first: 1,
    last: 1, // Only first page to reduce token usage
    scale: 0.5, // Medium scale for better OCR quality
    imageDataUrl: true,
    imageBuffer: false,
    desiredWidth: 1200, // Higher width for better OCR
  });

  const pages: string[] = [];

  // Extract base64 images from screenshot result (only first page)
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

  // If image is too large (base64 size > 4MB), return error
  if (imageSize > 4000000) {
    throw new Error(
      `Image is too large (${(imageSize / 1024).toFixed(
        0
      )}KB base64). Please use a smaller PDF or ensure it's text-based.`
    );
  }

  return imageData;
}
