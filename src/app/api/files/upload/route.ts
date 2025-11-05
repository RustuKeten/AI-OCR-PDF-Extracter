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
    let hasImages = false;

    console.log(
      `[Upload] PDF text extraction complete. Extracted ${extractedText.length} characters`
    );

    const JSON_TEMPLATE = createEmptyResumeTemplate();
    const openai = getOpenAI();
    let messages: any[] | undefined = undefined;

    // Try to extract images for ALL PDFs (handles hybrid PDFs with both text and images)
    // Returns array of image data URLs (one per page, max 3 pages)
    let imageDataUrls: string[] = [];
    try {
      imageDataUrls = await extractImagesAsBase64(buffer);
      hasImages = imageDataUrls.length > 0;
      console.log(
        `[Upload] Successfully extracted ${imageDataUrls.length} images from PDF`
      );
    } catch (imageError) {
      console.log(
        "[Upload] No images found or image extraction failed:",
        imageError
      );
      // Don't throw error - continue with text-only processing
      hasImages = false;
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
      for (const imageDataUrl of imageDataUrls) {
        contentArray.push({
          type: "image_url",
          image_url: {
            url: imageDataUrl,
          },
        });
      }

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
    if (!hasImages || imageDataUrls.length === 0 || !messages) {
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
    console.log("[Upload] Calling OpenAI for structured extraction...");
    const completion = await openai.chat.completions.create({
      model: isImageBased ? "gpt-4o" : "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages,
    });

    let result = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as ResumeData;

    result = reorderResumeData(result);

    // --- Save extracted data ---
    // Update file status
    await prisma.file.update({
      where: { id: fileRecord.id },
      data: {
        status: "completed",
      },
    });

    // Create or update ResumeData with the extracted JSON
    await prisma.resumeData.upsert({
      where: { fileId: fileRecord.id },
      create: {
        userId: userId!,
        fileId: fileRecord.id,
        data: result as any,
      },
      update: {
        data: result as any,
      },
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

    // --- Deduct credits ---
    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: CREDITS_REQUIRED } },
    });

    console.log("[Upload] Processing completed successfully");

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
            console.log(
              `[Image Extraction] Found ${
                keys.length
              } XObject entries in page ${pageIndex + 1}`
            );

            for (const key of keys) {
              const xObjectItem = xObject.lookup?.(key);

              if (xObjectItem?.lookup) {
                const subtype = xObjectItem.lookup("Subtype");

                if (subtype?.name === "Image") {
                  console.log(
                    `[Image Extraction] Found Image XObject: ${key} on page ${
                      pageIndex + 1
                    }`
                  );

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
                    console.log(
                      `[Image Extraction] Found image bytes: ${
                        imageBytes.length
                      } bytes on page ${pageIndex + 1}`
                    );

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

  try {
    // Step 1: Upload the PDF file to PDF.co using base64
    const base64Pdf = buffer.toString("base64");

    console.log("[Image Extraction] Step 1: Uploading PDF to PDF.co...");
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
    console.log(`[Image Extraction] PDF uploaded successfully, URL: ${pdfUrl}`);

    // Step 2: Convert PDF to PNG using the uploaded URL
    // Note: PDF.co pages are 0-indexed
    // Convert up to 3 pages (0, 1, 2) for multi-page resumes
    console.log(
      "[Image Extraction] Step 2: Converting PDF to PNG (up to 3 pages)..."
    );
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
          pages: "0-2", // Convert first 3 pages (0-indexed: 0, 1, 2)
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

      for (let i = 0; i < Math.min(convertData.urls.length, 3); i++) {
        const imageUrl = convertData.urls[i];
        console.log(
          `[Image Extraction] Downloading image from page ${i + 1}: ${imageUrl}`
        );

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          console.warn(
            `[Image Extraction] Failed to download image from page ${i + 1}: ${
              imageResponse.status
            }`
          );
          continue;
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const base64Image = imageBuffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64Image}`;

        // Check size per image
        if (dataUrl.length > 4000000) {
          console.warn(
            `[Image Extraction] Image from page ${i + 1} is too large, skipping`
          );
          continue;
        }

        imageDataUrls.push(dataUrl);
      }

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
