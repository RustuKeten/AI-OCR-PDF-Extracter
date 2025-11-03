"use client";

import { useState } from "react";
import { ResumeData } from "@/types/resume";

type ApiResult = ResumeData | { error: string };

export default function PdfUploader() {
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to parse PDF");
      }

      setResult(data);
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <input
        type="file"
        accept="application/pdf"
        onChange={handleUpload}
        className="mb-4"
      />

      {loading && <p className="text-blue-600">Extracting...</p>}

      {result && (
        <div className="mt-4">
          {"error" in result ? (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              <strong>Error:</strong> {result.error}
            </div>
          ) : (
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto max-h-[600px]">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
