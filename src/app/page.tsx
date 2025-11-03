import PdfUploader from "@/components/PdfUploader";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-4xl flex-col items-center py-16 px-8">
        <div className="w-full space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-black dark:text-zinc-50">
              PDF Resume Parser
            </h1>
            <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              Upload a PDF resume to extract structured data
            </p>
          </div>
          <PdfUploader />
        </div>
      </main>
    </div>
  );
}
