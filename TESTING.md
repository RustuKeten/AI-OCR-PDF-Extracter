# Testing Guide

## Prerequisites

1. Make sure you have a `.env.local` file with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

## Testing the API

### Option 1: Test GET Endpoint (Quick Check)

Test if the endpoint is accessible:

```bash
curl http://localhost:3000/api/extract
```

This will return information about the API endpoint and verify if your `OPENAI_API_KEY` is set.

### Option 2: Test with a PDF File

Use the test script to test with an actual PDF:

```bash
npm run test:api ./path/to/your/resume.pdf
```

Example:
```bash
npm run test:api ./sample-resume.pdf
```

The test script will:
- ✅ Check if the server is running
- ✅ Read the PDF file
- ✅ Send a POST request to `/api/extract`
- ✅ Display the response
- ✅ Validate the response structure
- ✅ Save the result to `test-result.json`

### Option 3: Test with cURL

You can also test manually with cURL:

```bash
curl -X POST http://localhost:3000/api/extract \
  -F "file=@/path/to/your/resume.pdf" \
  -H "Content-Type: multipart/form-data"
```

### Option 4: Test from Browser

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000` in your browser
3. Use the PDF uploader component on the homepage
4. Upload a PDF file and see the results

## Expected Response

A successful response should return a JSON object with the following structure:

```json
{
  "profile": {
    "name": "...",
    "surname": "...",
    "email": "...",
    ...
  },
  "workExperiences": [],
  "educations": [],
  "skills": [],
  "licenses": [],
  "languages": [],
  "achievements": [],
  "publications": [],
  "honors": []
}
```

## Troubleshooting

### Error: "Server is not running"
- Make sure you've started the dev server with `npm run dev`
- Check that the server is running on port 3000 (or the PORT specified in your environment)

### Error: "No file uploaded"
- Make sure you're sending the file with the field name `file`
- Verify the file path is correct

### Error: "Failed to parse PDF"
- Check that the PDF file is valid
- Verify that your OpenAI API key is set correctly
- Check the server logs for more details

### Error: "OPENAI_API_KEY is not set"
- Create a `.env.local` file in the project root
- Add your OpenAI API key: `OPENAI_API_KEY=your_key_here`
- Restart the dev server


