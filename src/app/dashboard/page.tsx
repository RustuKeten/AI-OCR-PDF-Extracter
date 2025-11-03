/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Navigation } from "@/components/navigation";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatsSection } from "@/components/dashboard/stats-section";
import { UploadSection } from "@/components/dashboard/upload-section";
import { FilesSection } from "@/components/dashboard/files-section";
import { ResumeModal } from "@/components/dashboard/resume-modal";
import { DeleteConfirmModal } from "@/components/dashboard/delete-confirm-modal";
import { Footer } from "@/components/footer";
import toast from "react-hot-toast";
import { Brain, Zap } from "lucide-react";

interface FileItem {
  id: string;
  fileName: string;
  fileSize: number;
  status: string;
  uploadedAt: string;
  hasResumeData: boolean;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [creditsRemaining, setCreditsRemaining] = useState(1000);
  const [planType, setPlanType] = useState("FREE");
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [resumeData, setResumeData] = useState<any>(null);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch user data on mount
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/signin");
      return;
    }
    fetchFiles();
    fetchCredits();
  }, [session, status, router]);

  // Poll for file updates while processing
  useEffect(() => {
    if (
      files.some((f) => f.status === "uploaded" || f.status === "processing")
    ) {
      const interval = setInterval(() => {
        fetchFiles();
        fetchCredits();
      }, 3000); // Poll every 3 seconds
      return () => clearInterval(interval);
    }
  }, [files]);

  const fetchFiles = async () => {
    try {
      const response = await fetch("/api/files");
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error("Error fetching files:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCredits = async () => {
    try {
      const response = await fetch("/api/files/credits");
      if (response.ok) {
        const data = await response.json();
        setCreditsRemaining(data.credits || 1000);
        setPlanType(data.planType || "FREE");
      }
    } catch (error) {
      console.error("Error fetching credits:", error);
    }
  };

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if it's an insufficient credits error (402 status)
        if (response.status === 402 && data.error === "Insufficient credits") {
          toast.error(
            data.message ||
              "You don't have enough credits to process this file.",
            {
              duration: 5000,
              icon: "⚠️",
            }
          );
          // Navigate to settings page after a short delay
          setTimeout(() => {
            router.push("/settings");
          }, 2000);
          return;
        }
        throw new Error(data.error || "Upload failed");
      }

      toast.success("File uploaded successfully! Processing...");
      await fetchFiles();
      await fetchCredits();
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.message || "Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  };

  const handleViewResumeData = async (fileId: string) => {
    try {
      const response = await fetch(`/api/files/${fileId}`);
      if (response.ok) {
        const data = await response.json();
        setResumeData(data.file.resumeData);
        setSelectedFile(fileId);
      } else {
        toast.error("Failed to load resume data");
      }
    } catch (error) {
      console.error("Error fetching resume data:", error);
      toast.error("Failed to load resume data");
    }
  };

  const handleCloseModal = () => {
    setSelectedFile(null);
    setResumeData(null);
  };

  const handleFileDelete = (fileId: string) => {
    setFileToDelete(fileId);
  };

  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/files/${fileToDelete}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete file");
      }

      toast.success("File deleted successfully");
      await fetchFiles(); // Refresh the files list
      setFileToDelete(null); // Close modal
    } catch (error: any) {
      console.error("Delete error:", error);
      toast.error(error.message || "Failed to delete file");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    if (!isDeleting) {
      setFileToDelete(null);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect to signin
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navigation currentPage="dashboard" />

      {/* AI Processing Info - Top Section */}
      <div className="bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900 dark:to-blue-900 border-b border-purple-300 dark:border-purple-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex items-start space-x-2 sm:space-x-3">
            <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
              <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600 dark:text-purple-400" />
              <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <h4 className="font-semibold text-black dark:text-white text-base sm:text-lg">
                AI-Powered PDF Extraction
              </h4>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="space-y-8">
          {/* Welcome Header */}
          <div className="text-center bg-card rounded-lg shadow-lg border border-border p-4 sm:p-6">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-card-foreground mb-2 break-words">
              Welcome back, {session.user?.name || session.user?.email}!
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Our advanced AI analyzes your PDF and extracts structured data
              automatically
            </p>
          </div>

          {/* Stats Section */}
          <StatsSection
            filesCount={files.length}
            creditsRemaining={creditsRemaining}
            planType={planType}
          />

          {/* Upload Section */}
          <UploadSection
            onFileSelect={handleFileSelect}
            isUploading={isUploading}
          />

          {/* Files Section */}
          <FilesSection
            files={files}
            loading={loading}
            onViewResumeData={handleViewResumeData}
            onFileDelete={handleFileDelete}
          />
        </div>
      </main>

      {/* Resume Data Modal */}
      <ResumeModal
        isOpen={!!selectedFile}
        onClose={handleCloseModal}
        resumeData={resumeData}
        fileName={
          selectedFile
            ? files.find((f) => f.id === selectedFile)?.fileName
            : undefined
        }
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!fileToDelete}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        fileName={
          fileToDelete
            ? files.find((f) => f.id === fileToDelete)?.fileName ||
              "Unknown file"
            : ""
        }
        isDeleting={isDeleting}
      />

      <Footer />
    </div>
  );
}
