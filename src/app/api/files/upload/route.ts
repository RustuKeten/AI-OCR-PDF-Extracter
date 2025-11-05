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

    // --- Extract text and images in parallel for better performance ---
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      console.log(
        `[Upload] Starting PDF processing for file: ${file.name} (${file.size} bytes)`
      );
    }

    const JSON_TEMPLATE = createEmptyResumeTemplate();
    const openai = getOpenAI();
    let messages: any[] | undefined = undefined;

    // Run text and image extraction in parallel for better performance
    const [extractedText, imageDataUrls] = await Promise.all([
      extractTextFromPDF(buffer),
      extractImagesAsBase64(buffer).catch(() => [] as string[]), // Don't fail if image extraction fails
    ]);

    let isImageBased = false;
    const hasImages = imageDataUrls.length > 0;

    if (isDev) {
      console.log(
        `[Upload] PDF extraction complete. Text: ${extractedText.length} chars, Images: ${imageDataUrls.length}`
      );
    }

    // Early exit: If we have sufficient text (>=100 chars), skip image processing for performance
    // Only process images if text is insufficient (likely image-based PDF)
    if (extractedText.length >= 100 && imageDataUrls.length === 0) {
      // Text-based PDF with sufficient text, skip image extraction
      if (isDev) {
        console.log(
          "[Upload] Text-based PDF detected, skipping image processing"
        );
      }
    } else if (extractedText.length < 50 && imageDataUrls.length === 0) {
      // Image-based PDF but no images extracted - check if API key is missing
      throw new Error(
        "PDF.co API key is not configured. Please set the PDFCO_API_KEY environment variable in Vercel to process image-based PDFs."
      );
    }

    // Build messages based on what we have: text-only, image-only, or hybrid (text + images)
    if (hasImages && imageDataUrls.length > 0) {
      isImageBased = extractedText.length < 50; // Use image model if mostly image-based

      // Prepare content array with text and all images (multi-page support)
      const contentArray: any[] = [
        {
          type: "text",
          text:
            extractedText.length >= 50
              ? `Extract all information from this multi-page resume. The resume contains both text and visual elements. Use BOTH the text content below AND all the images to extract complete information from all pages.\n\nText content from PDF:\n${extractedText.substring(
                  0,
                  50000
                )}\n\nAdditionally, analyze all resume images (${
                  imageDataUrls.length
                } page${
                  imageDataUrls.length > 1 ? "s" : ""
                }) to extract any information that might not be in the text, such as formatting, visual elements, or text that wasn't properly extracted. Extract information from ALL pages.\n\nReturn a complete JSON object matching this schema with all available data extracted:\n${JSON.stringify(
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

IMPORTANT: Combine information from both the text AND all images (all pages). Extract information from all pages of the resume. Do not return empty strings or empty arrays unless the information is truly not in the resume. Extract everything you can find!`
              : `Extract all information from this multi-page resume (${
                  imageDataUrls.length
                } page${
                  imageDataUrls.length > 1 ? "s" : ""
                }) and populate the JSON structure. Fill in ALL fields with actual data from the resume. Extract information from ALL pages.\n\nReturn a complete JSON object matching this schema with all available data extracted:\n${JSON.stringify(
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

IMPORTANT: Analyze all pages of the resume. Do not return empty strings or empty arrays unless the information is truly not in the resume. Extract everything you can find from all pages!`,
        },
      ];

      // Add all images to content array (multi-page support)
      // Validate and add each image
      let validImageCount = 0;
      for (const imageDataUrl of imageDataUrls) {
        // Validate image data URL format
        if (!imageDataUrl || typeof imageDataUrl !== "string") {
          console.warn("[Upload] Skipping invalid image data URL");
          continue;
        }

        const imageMatch = imageDataUrl.match(
          /^data:image\/(png|jpeg|jpg);base64,([^\s\n]+)$/i
        );
        if (!imageMatch) {
          console.warn(
            "[Upload] Image data URL format invalid:",
            imageDataUrl.substring(0, 50)
          );
          continue;
        }

        const base64Data = imageMatch[2];
        if (!base64Data || base64Data.length === 0) {
          console.warn("[Upload] Image has no base64 data");
          continue;
        }

        // Check size (OpenAI has a 20MB limit per image)
        if (imageDataUrl.length > 20000000) {
          console.warn(
            `[Upload] Image too large (${(
              imageDataUrl.length /
              1024 /
              1024
            ).toFixed(2)}MB), skipping`
          );
          continue;
        }

        contentArray.push({
          type: "image_url",
          image_url: {
            url: imageDataUrl,
          },
        });
        validImageCount++;
      }

      if (validImageCount === 0) {
        console.error("[Upload] No valid images found after validation");
        throw new Error(
          "Failed to prepare images for OpenAI. The images may be corrupted or invalid."
        );
      }

      console.log(
        `[Upload] Added ${validImageCount} valid image(s) to OpenAI request`
      );

      messages = [
        {
          role: "system",
          content:
            "You are an expert resume parser. Your task is to extract all available information from the resume using OCR and populate the JSON structure. Extract every piece of information you can find - names, emails, work experience, education, skills, etc. Do NOT leave fields empty if the information exists in the resume. Only leave fields empty if the information is truly not present in the resume.",
        },
        {
          role: "user",
          content: contentArray,
        },
      ];
    }

    // If no images found or image extraction failed, use text-only processing
    // But if PDF is image-based (little text), we should have failed earlier
    if (!hasImages || imageDataUrls.length === 0 || !messages) {
      // If we have very little text and no images, this is likely an image-based PDF we couldn't process
      if (extractedText.length < 50) {
        console.error(
          "[Upload] Very little text extracted and no images found - this may be an image-based PDF"
        );
        console.error(
          "[Upload] Extracted text:",
          extractedText.substring(0, 100)
        );
        // If we have less than 50 characters and no images, throw an error
        throw new Error(
          "Cannot process image-based PDF. The PDF appears to be a scanned/image-based document with insufficient text. Please ensure PDFCO_API_KEY is configured in Vercel to process image-based PDFs."
        );
      }
      isImageBased = false;
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

    // --- Call OpenAI for structured extraction ---
    if (!messages || messages.length === 0) {
      throw new Error(
        "Failed to prepare messages for OpenAI. Please try again."
      );
    }

    // Only log in development for performance
    if (isDev) {
      console.log("[Upload] Calling OpenAI for structured extraction...");
      console.log(
        `[Upload] Model: ${isImageBased ? "gpt-4o" : "gpt-4o-mini"}, Text: ${
          extractedText.length
        } chars, Images: ${imageDataUrls.length}`
      );
    }

    const completion = await openai.chat.completions.create({
      model: isImageBased ? "gpt-4o" : "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages,
    });

    const responseContent = completion.choices[0]?.message?.content;
    if (
      !responseContent ||
      responseContent.trim() === "" ||
      responseContent === "{}"
    ) {
      console.error("[Upload] OpenAI returned empty or invalid response");
      console.error(
        "[Upload] Full completion:",
        JSON.stringify(completion, null, 2)
      );
      throw new Error(
        "OpenAI returned an empty response. The PDF may be too complex or the image quality may be insufficient."
      );
    }

    console.log(
      `[Upload] OpenAI response length: ${responseContent.length} characters`
    );
    let result: ResumeData;
    try {
      result = JSON.parse(responseContent) as ResumeData;
    } catch (parseError) {
      console.error("[Upload] Failed to parse OpenAI response as JSON");
      console.error(
        "[Upload] Response content:",
        responseContent.substring(0, 500)
      );
      throw new Error(
        `Failed to parse OpenAI response: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`
      );
    }

    // Validate that we got actual data, not just empty structure
    const isEmpty =
      !result ||
      (!result.profile?.name &&
        !result.profile?.surname &&
        (!result.workExperiences || result.workExperiences.length === 0) &&
        (!result.educations || result.educations.length === 0) &&
        (!result.skills || result.skills.length === 0));

    if (isEmpty) {
      console.error("[Upload] OpenAI returned empty resume data structure");
      console.error(
        "[Upload] Response content:",
        responseContent.substring(0, 1000)
      );
      console.error("[Upload] Full result:", JSON.stringify(result, null, 2));

      // If we were processing an image-based PDF and got empty results, this is an error
      if (isImageBased || extractedText.length < 50) {
        throw new Error(
          "Failed to extract data from image-based PDF. The PDF may be too complex, the image quality may be insufficient, or the PDF may not contain readable resume information."
        );
      }

      // For text-based PDFs, log warning but still return result
      console.warn(
        "[Upload] Text-based PDF returned minimal data - this may be expected for some resumes"
      );
    }

    result = reorderResumeData(result);

    // --- Save extracted data and update credits in parallel for better performance ---
    await Promise.all([
      // Update file status
      prisma.file.update({
        where: { id: fileRecord.id },
        data: { status: "completed" },
      }),
      // Create or update ResumeData
      prisma.resumeData.upsert({
        where: { fileId: fileRecord.id },
        create: {
          userId: userId!,
          fileId: fileRecord.id,
          data: result as any,
        },
        update: {
          data: result as any,
        },
      }),
      // Create history record
      prisma.resumeHistory.create({
        data: {
          userId: userId!,
          fileId: fileRecord.id,
          action: "extract",
          status: "success",
          message: "Resume data extracted successfully",
        },
      }),
      // Deduct credits
      prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: CREDITS_REQUIRED } },
      }),
    ]);

    if (isDev) {
      console.log("[Upload] Processing completed successfully");
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[Upload] Processing error:", error);

    let userMessage =
      "Failed to process PDF. Please try again or use a different file.";

    if (error instanceof Error) {
      const errorMsg = error.message;

      if (
        errorMsg.includes("worker") ||
        errorMsg.includes("pdfjs-dist") ||
        errorMsg.includes("Cannot find module")
      ) {
        userMessage =
          "Image-based PDF processing is currently unavailable. Please use a text-based PDF or convert your PDF to a text-based format.";
      } else if (errorMsg.includes("Insufficient credits")) {
        userMessage = errorMsg;
      } else if (errorMsg.includes("image-based") || errorMsg.includes("OCR")) {
        userMessage =
          "Unable to process this image-based PDF. Please ensure the PDF contains selectable text or convert it to a text-based PDF.";
      } else if (errorMsg.includes("timeout")) {
        userMessage =
          "PDF processing timed out. Please try with a smaller file or ensure the PDF is not corrupted.";
      } else if (
        errorMsg.includes("corrupted") ||
        errorMsg.includes("invalid")
      ) {
        userMessage =
          "The PDF file appears to be corrupted or invalid. Please try with a different PDF file.";
      } else if (errorMsg.length < 200) {
        userMessage = errorMsg;
      }
    }

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
            message: `Processing failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
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
              const textContent = pdfParser.getRawTextContent() || "";
              resolve(textContent.trim());
            } catch (error) {
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
      new Promise<string>((_, reject) => {
        setTimeout(() => {
          reject(new Error("PDF parsing timeout after 30 seconds"));
        }, 30000);
      }),
    ]);

    try {
      await fs.unlink(tempFilePath);
    } catch (unlinkError) {
      console.warn("[PDF Extraction] Failed to delete temp file:", unlinkError);
    }

    console.log(`[PDF Extraction] Extracted ${parsedText.length} characters`);
    return parsedText;
  } catch (error) {
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

/**
 * Extract images from PDF using pdf-lib (pure JS, no canvas)
 * Supports multi-page PDFs - extracts images from all pages
 * Falls back to PDF.co API if no embedded images found
 * Returns array of image data URLs (one per page, max 3 pages for resumes)
 */
async function extractImagesAsBase64(buffer: Buffer): Promise<string[]> {
  console.log("[Image Extraction] Starting image extraction from PDF buffer");

  try {
    const { PDFDocument } = await import("pdf-lib");
    console.log("[Image Extraction] pdf-lib imported successfully");

    // Load the PDF document
    const pdfDoc = await PDFDocument.load(buffer);
    console.log("[Image Extraction] PDF document loaded");

    // Get pages
    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
      throw new Error("PDF has no pages");
    }
    console.log(`[Image Extraction] PDF has ${pages.length} pages`);

    // For resumes, typically 1-3 pages are enough, but we'll process up to 3 pages
    const maxPages = Math.min(pages.length, 3);
    const images: string[] = [];

    // Use pdf-lib's direct API: page.node.Resources().lookupMaybe("XObject")
    // Process up to 3 pages for multi-page resumes
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const page = pages[pageIndex];
      try {
        const pageNode = (page as any).node;
        const resources = pageNode?.Resources?.() || pageNode?.resources?.();

        if (resources) {
          // Use lookupMaybe to safely get XObject
          const xObject =
            resources.lookupMaybe?.("XObject") || resources.lookup?.("XObject");

          if (xObject) {
            const keys = xObject.keys?.() || [];

            for (const key of keys) {
              const xObjectItem = xObject.lookup?.(key);

              if (xObjectItem?.lookup) {
                const subtype = xObjectItem.lookup("Subtype");

                if (subtype?.name === "Image") {
                  // Try to get image bytes
                  let imageBytes =
                    xObjectItem.contents || xObjectItem.lookup("Data");

                  // If not found, try to get from stream
                  if (!imageBytes) {
                    const stream = xObjectItem as any;
                    imageBytes =
                      stream.contentsBytes || stream.contents || stream.bytes;
                  }

                  if (imageBytes && imageBytes.length > 1000) {
                    // Detect MIME type
                    let mimeType = "image/jpeg";
                    const contentBuffer = Buffer.from(imageBytes);

                    if (
                      contentBuffer[0] === 0xff &&
                      contentBuffer[1] === 0xd8
                    ) {
                      mimeType = "image/jpeg";
                    } else if (
                      contentBuffer[0] === 0x89 &&
                      contentBuffer[1] === 0x50
                    ) {
                      mimeType = "image/png";
                    }

                    const base64Image =
                      Buffer.from(imageBytes).toString("base64");
                    const dataUrl = `data:${mimeType};base64,${base64Image}`;

                    // Check size per image
                    if (dataUrl.length > 4000000) {
                      console.warn(
                        `[Image Extraction] Image on page ${
                          pageIndex + 1
                        } is too large, skipping`
                      );
                      continue;
                    }

                    images.push(dataUrl);
                    console.log(
                      `[Image Extraction] Successfully extracted image from page ${
                        pageIndex + 1
                      }: ${mimeType}, ${imageBytes.length} bytes`
                    );

                    // Found an image for this page, move to next page
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (pageError) {
        console.warn(
          `[Image Extraction] Error processing page ${pageIndex + 1}:`,
          pageError
        );
        continue;
      }
    }

    // If we found embedded images, return them (up to 3 pages)
    if (images.length > 0) {
      console.log(
        `[Image Extraction] Successfully extracted ${images.length} images from ${maxPages} pages`
      );
      return images;
    }

    // If no embedded images found, try API fallback
    console.log(
      "[Image Extraction] No embedded images found, trying API fallback..."
    );
    return await convertPdfToImageViaApi(buffer);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Image Extraction] Error occurred:", errorMsg);
    console.error("[Image Extraction] Full error:", error);

    // If it's a canvas/rendering error, provide a helpful message
    if (
      errorMsg.includes("canvas") ||
      (errorMsg.includes("rendering") &&
        (errorMsg.includes("worker") || errorMsg.includes("pdfjs-dist"))) ||
      errorMsg.includes("worker") ||
      errorMsg.includes("pdfjs-dist") ||
      errorMsg.includes("Cannot find module") ||
      errorMsg.includes("@napi-rs/canvas")
    ) {
      console.error("[Image Extraction] Canvas/rendering error detected");
      throw new Error(
        "Image-based PDF processing is currently unavailable. Please use a text-based PDF or convert your scanned PDF to a text-based format."
      );
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Fallback: Convert PDF to image using external API (for scanned PDFs without embedded images)
 * Converts up to 3 pages for multi-page resumes
 * Returns array of image data URLs
 */
async function convertPdfToImageViaApi(buffer: Buffer): Promise<string[]> {
  // Check if PDF.co API key is configured
  const pdfCoApiKey = process.env.PDFCO_API_KEY;

  if (!pdfCoApiKey) {
    throw new Error(
      "SCANNED_PDF_LIMITATION: No embedded images found in PDF and no PDF conversion API configured. Please:\n1. Convert your PDF to a text-based format using OCR software\n2. Or configure PDFCO_API_KEY environment variable for PDF-to-image conversion"
    );
  }

  console.log("[Image Extraction] Converting PDF to image via PDF.co API...");

  // First, get the page count to request only existing pages
  const { PDFDocument } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.load(buffer);
  const pages = pdfDoc.getPages();
  const pageCount = pages.length;
  const maxPagesToConvert = Math.min(pageCount, 3); // Convert up to 3 pages, but only if they exist

  console.log(
    `[Image Extraction] PDF has ${pageCount} page(s), will convert ${maxPagesToConvert} page(s)`
  );

  // Build pages parameter based on actual page count
  // PDF.co uses 0-indexed pages, so:
  // 1 page: "0"
  // 2 pages: "0-1"
  // 3+ pages: "0-2" (convert first 3)
  let pagesParam: string;
  if (maxPagesToConvert === 1) {
    pagesParam = "0";
  } else {
    pagesParam = `0-${maxPagesToConvert - 1}`;
  }

  console.log(`[Image Extraction] Requesting pages: ${pagesParam}`);

  try {
    // Step 1: Upload the PDF file to PDF.co using base64
    const base64Pdf = buffer.toString("base64");

    const uploadResponse = await fetch(
      "https://api.pdf.co/v1/file/upload/base64",
      {
        method: "POST",
        headers: {
          "x-api-key": pdfCoApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: base64Pdf,
          fileName: "temp.pdf",
        }),
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("[Image Extraction] PDF.co upload error:", errorText);
      throw new Error(
        `PDF upload API failed: ${uploadResponse.status} ${errorText}`
      );
    }

    const uploadData = await uploadResponse.json();

    if (!uploadData.url) {
      throw new Error("PDF.co upload API did not return a URL");
    }

    const pdfUrl = uploadData.url;

    // Step 2: Convert PDF to PNG using the uploaded URL
    // Note: PDF.co pages are 0-indexed
    // Only request pages that actually exist
    const convertResponse = await fetch(
      "https://api.pdf.co/v1/pdf/convert/to/png",
      {
        method: "POST",
        headers: {
          "x-api-key": pdfCoApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pdfUrl,
          pages: pagesParam, // Only request pages that exist (0-indexed)
          async: false,
        }),
      }
    );

    if (!convertResponse.ok) {
      const errorText = await convertResponse.text();
      console.error("[Image Extraction] PDF.co conversion error:", errorText);
      throw new Error(
        `PDF conversion API failed: ${convertResponse.status} ${errorText}`
      );
    }

    const convertData = await convertResponse.json();

    // PDF.co returns image URLs array (one per page)
    const imageDataUrls: string[] = [];

    if (convertData.urls && convertData.urls.length > 0) {
      // Download all converted images (up to 3 pages)
      console.log(
        `[Image Extraction] Image conversion successful, ${convertData.urls.length} pages converted`
      );

      // Download images in parallel for better performance
      const maxPages =
        maxPagesToConvert || Math.min(convertData.urls.length, 3);
      const downloadPromises = convertData.urls
        .slice(0, maxPages)
        .map(async (imageUrl: string) => {
          try {
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
              return null;
            }

            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            const base64Image = imageBuffer.toString("base64");
            const dataUrl = `data:image/png;base64,${base64Image}`;

            // Check size per image (4MB limit for faster processing)
            if (dataUrl.length > 4000000) {
              return null;
            }

            return dataUrl;
          } catch {
            return null;
          }
        });

      const downloadedImages = await Promise.all(downloadPromises);
      imageDataUrls.push(
        ...downloadedImages.filter((img): img is string => img !== null)
      );

      if (imageDataUrls.length > 0) {
        console.log(
          `[Image Extraction] Successfully downloaded ${imageDataUrls.length} images`
        );
        return imageDataUrls;
      }
    } else if (convertData.body) {
      // If API returns base64 directly (single page)
      return [`data:image/png;base64,${convertData.body}`];
    } else {
      throw new Error("PDF conversion API returned no image data");
    }

    throw new Error("Failed to convert PDF pages to images");
  } catch (apiError) {
    console.error("[Image Extraction] PDF conversion API error:", apiError);
    throw new Error(
      `Failed to convert PDF to image via API: ${
        apiError instanceof Error ? apiError.message : "Unknown error"
      }`
    );
  }
}
