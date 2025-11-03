/**
 * Test script for /api/extract endpoint
 * Run this with: npm run test:api [path-to-pdf-file]
 * Example: npm run test:api ./sample-resume.pdf
 */

import fs from "fs";
import path from "path";

async function testExtractAPI() {
  const PORT = process.env.PORT || 3000;
  const API_URL = `http://localhost:${PORT}/api/extract`;

  console.log("🧪 Testing /api/extract endpoint\n");

  // Check if server is running
  try {
    const healthCheck = await fetch(`http://localhost:${PORT}`);
    if (healthCheck.ok) {
      console.log("✓ Server is running on port", PORT);
    } else {
      console.log("⚠ Server responded with status:", healthCheck.status);
    }
  } catch (error) {
    console.error("✗ Server is not running. Please start it with: npm run dev");
    console.error("  Make sure the dev server is running on port", PORT);
    process.exit(1);
  }

  // Check if we have a test PDF file
  const testPdfPath = process.argv[2];
  
  if (!testPdfPath || !fs.existsSync(testPdfPath)) {
    console.log(`\n⚠ No PDF file provided or file not found`);
    console.log("\nUsage:");
    console.log(`  npm run test:api [path-to-pdf-file]`);
    console.log("\nExample:");
    console.log(`  npm run test:api ./sample-resume.pdf`);
    console.log("\nTesting GET endpoint instead...");
    
    try {
      const getResponse = await fetch(API_URL);
      const getData = await getResponse.json();
      console.log("\n✓ GET endpoint response:");
      console.log(JSON.stringify(getData, null, 2));
    } catch (error) {
      console.error("✗ GET request failed:", error);
    }
    
    return;
  }

  console.log(`\n📄 Testing with PDF: ${testPdfPath}`);
  
  // Read the PDF file
  if (!fs.existsSync(testPdfPath)) {
    console.error(`✗ File not found: ${testPdfPath}`);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(testPdfPath);
  console.log(`✓ PDF file read (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);

  // Create FormData using form-data library for Node.js compatibility
  const FormDataLib = await import("form-data");
  const FormData = FormDataLib.default || FormDataLib;
  const formData = new FormData();
  
  formData.append("file", pdfBuffer, {
    filename: path.basename(testPdfPath),
    contentType: "application/pdf",
  });

  console.log("\n🔄 Sending POST request to /api/extract...");
  console.log("   (This may take up to 60 seconds depending on PDF complexity)");
  console.log("   (Requires OPENAI_API_KEY environment variable)");

  const startTime = Date.now();

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      // @ts-ignore - form-data types
      body: formData,
      headers: formData.getHeaders ? formData.getHeaders() : {},
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n⏱ Response received in ${duration}s`);
    console.log(`📊 Status: ${response.status} ${response.statusText}`);

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const text = await response.text();
      console.log("\n⚠ Non-JSON response received:");
      console.log(text.substring(0, 500));
      return;
    }

    const result = await response.json();

    if (!response.ok) {
      console.error("\n✗ Error response:");
      console.error(JSON.stringify(result, null, 2));
      return;
    }

    console.log("\n✅ Success! Response received:");
    console.log(JSON.stringify(result, null, 2));

    // Validate response structure
    console.log("\n🔍 Validating response structure...");
    const requiredFields = [
      "profile",
      "workExperiences",
      "educations",
      "skills",
      "licenses",
      "languages",
      "achievements",
      "publications",
      "honors",
    ];

    const missingFields = requiredFields.filter((field) => !(field in result));
    if (missingFields.length > 0) {
      console.warn(`⚠ Missing fields: ${missingFields.join(", ")}`);
    } else {
      console.log("✓ All required fields present");
    }

    // Validate profile structure
    if (result.profile) {
      console.log("\n✓ Profile data extracted");
      if (result.profile.name || result.profile.email) {
        console.log(`  Name: ${result.profile.name || "N/A"}`);
        console.log(`  Email: ${result.profile.email || "N/A"}`);
      }
    }

    // Save result to file
    const outputPath = "test-result.json";
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 Result saved to: ${outputPath}`);
  } catch (error) {
    console.error("\n✗ Request failed:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Stack:", error.stack);
    }
  }
}

// Run the test
testExtractAPI().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

