import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumeData } from "@/types/resume";
import { createEmptyResumeTemplate } from "@/utils/resumeTemplate";
import { reorderResumeData } from "@/utils/resumeOrder";
import { getOpenAI } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const CREDITS_REQUIRED = 100;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Check user credits
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if user has sufficient credits
    if (user.credits < CREDITS_REQUIRED) {
      // Get user's plan type for better error message
      const userWithPlan = await prisma.user.findUnique({
        where: { id: userId },
        select: { planType: true },
      });

      const upgradeMessage =
        userWithPlan?.planType === "FREE"
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

    // Create file record
    const fileRecord = await prisma.file.create({
      data: {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || "application/pdf",
        userId: userId,
        status: "processing",
      },
    });

    // Create initial history entry
    await prisma.resumeHistory.create({
      data: {
        userId: userId,
        fileId: fileRecord.id,
        action: "upload",
        status: "success",
        message: "File uploaded successfully",
      },
    });

    try {
      // Extract text from PDF using pdf-parse (same as /api/extract)
      let extractedText = await extractTextFromPDF(buffer);
      let isImageBased = false;

      // If text is too short, fallback to image-based extraction
      if (extractedText.length < 30) {
        try {
          extractedText = await extractImagesAsBase64(buffer);
          isImageBased = true;
          await prisma.resumeHistory.create({
            data: {
              userId: userId,
              fileId: fileRecord.id,
              action: "process",
              status: "pending",
              message: "Image-based PDF detected, using OCR extraction",
            },
          });
        } catch {
          throw new Error(
            "PDF appears to be image-based but the image is too large to process. Please use a smaller PDF or ensure it's text-based."
          );
        }
      }

      // Get the JSON template for the schema
      const JSON_TEMPLATE = createEmptyResumeTemplate();

      // Create history entry for extraction
      await prisma.resumeHistory.create({
        data: {
          userId: userId,
          fileId: fileRecord.id,
          action: "extract",
          status: "pending",
          message: "Processing with OpenAI...",
        },
      });

      // Prepare messages based on whether it's image-based or text-based
      let messages: any[];

      if (isImageBased) {
        // For image-based PDFs, extract the base64 image from the prompt text
        // The extractImagesAsBase64 function returns: "This PDF contains scanned images. Please perform OCR on the following base64-encoded PNG image and extract the resume data:\n${imageData}"
        // where imageData is a full data URL like "data:image/png;base64,iVBORw0KGgo..."
        const imageMatch = extractedText.match(
          /data:image\/[^;]+;base64,([^\s\n]+)/
        );

        if (imageMatch && imageMatch[1]) {
          // Use vision API for image-based PDFs
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
                  text: `Extract all information from this resume image and populate the JSON structure. Fill in ALL fields with actual data from the resume. Only leave fields empty if the information is not available in the resume.

Return a complete JSON object matching this schema with all available data extracted:
${JSON.stringify(JSON_TEMPLATE, null, 2)}

Instructions:
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
          // Fallback to text-based processing if image extraction failed
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
          // If image extraction failed, treat as text-based
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

      // Extract structured data using OpenAI
      // Use gpt-4o for image-based PDFs (has vision support), gpt-4o-mini for text-based
      const openai = getOpenAI();
      const completion = await openai.chat.completions.create({
        model: isImageBased ? "gpt-4o" : "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: messages,
      });

      let resumeData = JSON.parse(
        completion.choices[0].message.content || "{}"
      ) as ResumeData;

      // Reorder the data to match schema order (profile first, then workExperiences, etc.)
      resumeData = reorderResumeData(resumeData);

      // Save structured resume data
      await prisma.resumeData.create({
        data: {
          userId: userId,
          fileId: fileRecord.id,
          data: resumeData as any,
        },
      });

      // Update file status
      await prisma.file.update({
        where: { id: fileRecord.id },
        data: { status: "completed" },
      });

      // Deduct credits for processing
      await prisma.user.update({
        where: { id: userId },
        data: {
          credits: {
            decrement: CREDITS_REQUIRED,
          },
        },
      });

      // Create success history entry
      await prisma.resumeHistory.create({
        data: {
          userId: userId,
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
          uploadedAt: fileRecord.uploadedAt.toISOString(),
        },
        resumeData: resumeData,
      });
    } catch (error: unknown) {
      // Update file status to failed
      await prisma.file.update({
        where: { id: fileRecord.id },
        data: { status: "failed" },
      });

      const errorMessage =
        error instanceof Error ? error.message : "Processing failed";

      // Create error history entry
      await prisma.resumeHistory.create({
        data: {
          userId: userId,
          fileId: fileRecord.id,
          action: "extract",
          status: "failed",
          message: errorMessage,
        },
      });

      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  } catch (err: unknown) {
    console.error(err);
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error occurred";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper functions (same as /api/extract)
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // Use dynamic import at runtime (works in Vercel serverless)
  const pdfParseModule = await import("pdf-parse");
  const PDFParse = (pdfParseModule as any).PDFParse;

  if (typeof PDFParse !== "function") {
    throw new Error("PDFParse class not found in pdf-parse module");
  }

  const pdfParser = new PDFParse({ data: buffer });
  const result = await pdfParser.getText();
  const extractedText = result?.text?.trim() || "";

  return extractedText;
}

async function extractImagesAsBase64(buffer: Buffer) {
  // Use dynamic import at runtime (works in Vercel serverless)
  const pdfParseModule = await import("pdf-parse");
  const PDFParse = (pdfParseModule as any).PDFParse;

  if (typeof PDFParse !== "function") {
    throw new Error("PDFParse class not found in pdf-parse module");
  }

  const pdfParser = new PDFParse({ data: buffer });
  const screenshotResult = await pdfParser.getScreenshot({
    first: 1,
    last: 1,
    scale: 0.2,
    imageDataUrl: true,
    imageBuffer: false,
    desiredWidth: 400,
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

  if (imageSize > 500000) {
    throw new Error(
      `Image is too large (${(imageSize / 1024).toFixed(
        0
      )}KB base64). Please use a smaller PDF or ensure it's text-based.`
    );
  }

  return `This PDF contains scanned images. Please perform OCR on the following base64-encoded PNG image and extract the resume data:\n${imageData}`;
}
